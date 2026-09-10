use std::sync::Arc;

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::CONTENT_TYPE;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::Response;
use serde_json::json;
use tokio::sync::oneshot;
use tracing::warn;

use super::constants::{html_error, html_escape, url_decode, HTML_SUCCESS, REDIRECT_PATH};
use super::manager::AuthManager;
use super::token::classify_auth_failure;
use super::types::{AuthError, AuthState};

struct CallbackPayload {
    code: String,
    state: String,
    completion: oneshot::Sender<Result<(), String>>,
}

impl AuthManager {
    pub(super) async fn serve_callback(
        self: Arc<Self>,
        listener: tokio::net::TcpListener,
        port: u16,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<(), AuthError> {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<CallbackPayload, AuthError>>(1);
        let timeout = tokio::time::sleep(std::time::Duration::from_secs(300));
        tokio::pin!(timeout);
        loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    return Ok(());
                }
                _ = &mut timeout => {
                    warn!("OAuth callback server timed out waiting for user auth");
                    self.emit(
                        "auth.failed",
                        serde_json::json!({
                            "reason": "other",
                            "message": "OAuth authorization timed out after 5 minutes",
                        }),
                    )
                    .await;
                    let snap = {
                        let mut s = self.state.lock().await;
                        s.state = if s.current.is_some() {
                            AuthState::Authenticated
                        } else {
                            AuthState::Unauthenticated
                        };
                        s.clear_all_pkce();
                        s.last_auth_url = None;
                        self.snapshot_locked(&s, None)
                    };
                    if let Ok(value) = serde_json::to_value(&snap) {
                        self.emit("auth.changed", value).await;
                    }
                    return Ok(());
                }
                msg = rx.recv() => {
                    match msg {
                        Some(Ok(payload)) => {
                            let CallbackPayload {
                                code,
                                state,
                                completion,
                            } = payload;
                            let result = self.complete_flow(&code, &state, port).await;
                            if let Err(error) = &result {
                                warn!(error = %error, "auth complete flow failed");
                                let (reason, message) = classify_auth_failure(error);
                                self.emit(
                                    "auth.failed",
                                    json!({ "reason": reason, "message": message }),
                                )
                                .await;
                            }
                            let _ = completion.send(result.map_err(|error| error.to_string()));
                            // One listener owns exactly one PKCE transaction.
                            // The next authentication phase replaces it with a
                            // freshly bound listener after this task exits.
                            break;
                        }
                        Some(Err(e)) => {
                            warn!(error = %e, "auth callback received error");
                            let snap = {
                                let mut s = self.state.lock().await;
                                s.state = if s.current.is_some() {
                                    AuthState::Authenticated
                                } else {
                                    AuthState::Unauthenticated
                                };
                                s.clear_all_pkce();
                                s.last_auth_url = None;
                                self.snapshot_locked(&s, None)
                            };
                            if let Ok(value) = serde_json::to_value(&snap) {
                                self.emit("auth.changed", value).await;
                            }
                            self.emit(
                                "auth.failed",
                                json!({ "reason": "other", "message": e.to_string() }),
                            )
                            .await;
                            break;
                        }
                        None => break,
                    }
                }
                accept = listener.accept() => {
                    let (stream, _addr) = match accept {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    let tx = tx.clone();
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let auth_mgr = Arc::clone(&self);
                    let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let tx = tx.clone();
                        let auth_mgr = Arc::clone(&auth_mgr);
                        async move {
                            if req.method() != hyper::Method::GET {
                                let html = html_error("Method Not Allowed", "Only GET is allowed for the OAuth callback");
                                let resp = Response::builder()
                                    .status(405)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            if req.uri().path() != REDIRECT_PATH && req.uri().path() != "/login" {
                                let html = html_error("Not Found", "Invalid callback path");
                                let resp = Response::builder()
                                    .status(404)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            let q = req.uri().query().unwrap_or("").to_string();
                            let params: std::collections::HashMap<String, String> = url_decode(&q);
                            let state = params.get("state").cloned().unwrap_or_default();
                            let has_matching_flow = {
                                let s = auth_mgr.state.lock().await;
                                s.find_pkce(&state).is_some()
                            };
                            if !has_matching_flow {
                                warn!("OAuth callback state mismatch, ignoring bogus request");
                                let html =
                                    html_error("State Mismatch", "Invalid OAuth state parameter. This browser tab is stale — complete the login in the newest tab Spotoei opened.");
                                let resp = Response::builder()
                                    .status(400)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            if let Some(err) = params.get("error") {
                                let safe_err = html_escape(err);
                                let _ = tx
                                    .send(Err(AuthError::OAuth(err.clone())))
                                    .await;
                                let html = html_error("Authorization Rejected", &safe_err);
                                let resp = Response::builder()
                                    .status(400)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            let code = params.get("code").cloned().unwrap_or_default();
                            if code.trim().is_empty() {
                                let html = html_error(
                                    "Authorization Failed",
                                    "Spotify did not return an authorization code. Return to Spotoei and retry.",
                                );
                                let resp = Response::builder()
                                    .status(400)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            let (completion_tx, completion_rx) = oneshot::channel();
                            if tx
                                .send(Ok(CallbackPayload {
                                    code,
                                    state,
                                    completion: completion_tx,
                                }))
                                .await
                                .is_err()
                            {
                                let html = html_error(
                                    "Authorization Failed",
                                    "Spotoei stopped waiting for this login. Return to the terminal and retry.",
                                );
                                let resp = Response::builder()
                                    .status(410)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            let completion = tokio::time::timeout(
                                std::time::Duration::from_secs(30),
                                completion_rx,
                            )
                            .await;
                            let (status, html) = match completion {
                                Ok(Ok(Ok(()))) => (200, HTML_SUCCESS.to_string()),
                                Ok(Ok(Err(_))) => (
                                    400,
                                    html_error(
                                        "Authorization Failed",
                                        "Spotify approved access, but Spotoei could not finish the token exchange. Return to the terminal for details and retry.",
                                    ),
                                ),
                                _ => (
                                    504,
                                    html_error(
                                        "Authorization Timed Out",
                                        "Spotoei did not finish the token exchange. Return to the terminal and retry.",
                                    ),
                                ),
                            };
                            let resp = Response::builder()
                                .status(status)
                                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                .body(Full::new(Bytes::from(html)))
                                .unwrap();
                            Ok::<_, std::convert::Infallible>(resp)
                        }
                    });
                    tokio::spawn(async move {
                        let _ = http1::Builder::new().serve_connection(io, svc).await;
                    });
                }
            }
        }
        *self.bound_port.lock().await = None;
        Ok(())
    }
}
