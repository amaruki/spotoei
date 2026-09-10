use std::sync::atomic::{AtomicBool, Ordering};
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

type CallbackOutcome = Result<(), String>;

fn callback_response(outcome: CallbackOutcome) -> Response<Full<Bytes>> {
    let (status, html) = match outcome {
        Ok(()) => (200, HTML_SUCCESS.to_string()),
        Err(_) => (
            400,
            html_error(
                "Authorization Failed",
                "Spotify approved access, but Spotoei could not finish the token exchange. Return to the terminal for details and retry.",
            ),
        ),
    };
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Full::new(Bytes::from(html)))
        .unwrap()
}

impl AuthManager {
    pub(super) async fn serve_callback(
        self: Arc<Self>,
        listener: tokio::net::TcpListener,
        port: u16,
        expected_state: String,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<(), AuthError> {
        let claimed = Arc::new(AtomicBool::new(false));
        let (claimed_tx, mut claimed_rx) = tokio::sync::mpsc::channel::<()>(1);
        let (outcome_tx, _) = tokio::sync::watch::channel::<Option<CallbackOutcome>>(None);
        let timeout = tokio::time::sleep(std::time::Duration::from_secs(300));
        tokio::pin!(timeout);
        loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    break;
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
                    break;
                }
                _ = claimed_rx.recv() => {
                    // The accepted connection now owns completion. Close the
                    // listening socket so the next OAuth phase can bind the
                    // same loopback port without aborting that connection.
                    break;
                }
                accept = listener.accept() => {
                    let (stream, _addr) = match accept {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let auth_mgr = Arc::clone(&self);
                    let connection_claimed = Arc::clone(&claimed);
                    let connection_claimed_tx = claimed_tx.clone();
                    let connection_expected_state = expected_state.clone();
                    let connection_outcome_tx = outcome_tx.clone();
                    let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let claimed = Arc::clone(&connection_claimed);
                        let claimed_tx = connection_claimed_tx.clone();
                        let expected_state = connection_expected_state.clone();
                        let outcome_tx = connection_outcome_tx.clone();
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
                            let matches_active_flow = if state == expected_state {
                                claimed.load(Ordering::Acquire)
                                    || auth_mgr.state.lock().await.find_pkce(&state).is_some()
                            } else {
                                false
                            };
                            if !matches_active_flow {
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
                            let code = params.get("code").cloned().unwrap_or_default();
                            if !params.contains_key("error") && code.trim().is_empty() {
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
                            let mut outcome_rx = outcome_tx.subscribe();
                            let is_leader = claimed
                                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                                .is_ok();
                            if !is_leader {
                                let wait = async {
                                    loop {
                                        if let Some(outcome) = outcome_rx.borrow().clone() {
                                            return outcome;
                                        }
                                        if outcome_rx.changed().await.is_err() {
                                            return Err("callback completion channel closed".to_string());
                                        }
                                    }
                                };
                                let outcome = tokio::time::timeout(
                                    std::time::Duration::from_secs(30),
                                    wait,
                                )
                                .await
                                .unwrap_or_else(|_| Err("callback completion timed out".to_string()));
                                return Ok::<_, std::convert::Infallible>(callback_response(outcome));
                            }
                            // Completion is owned by this accepted connection,
                            // not by the listener task. Listener cancellation
                            // must never invalidate a callback already in hand.
                            let _ = claimed_tx.try_send(());
                            if let Some(err) = params.get("error") {
                                let safe_err = html_escape(err);
                                let auth_error = AuthError::OAuth(err.clone());
                                let snap = {
                                    let mut current = auth_mgr.state.lock().await;
                                    if current.remove_pkce(&state).is_some() {
                                        current.state = if current.current.is_some() {
                                            AuthState::Authenticated
                                        } else {
                                            AuthState::Unauthenticated
                                        };
                                        current.last_auth_url = None;
                                        Some(auth_mgr.snapshot_locked(&current, None))
                                    } else {
                                        None
                                    }
                                };
                                if let Some(snap) = snap {
                                    if let Ok(value) = serde_json::to_value(&snap) {
                                        auth_mgr.emit("auth.changed", value).await;
                                    }
                                    auth_mgr
                                        .emit(
                                            "auth.failed",
                                            json!({ "reason": "other", "message": auth_error.to_string() }),
                                        )
                                        .await;
                                }
                                let _ = outcome_tx.send(Some(Err(auth_error.to_string())));
                                let html = html_error("Authorization Rejected", &safe_err);
                                let resp = Response::builder()
                                    .status(400)
                                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                    .body(Full::new(Bytes::from(html)))
                                    .unwrap();
                                return Ok::<_, std::convert::Infallible>(resp);
                            }
                            let result = auth_mgr.complete_flow(&code, &state, port).await;
                            if let Err(error) = &result {
                                warn!(error = %error, "auth complete flow failed");
                                let (reason, message) = classify_auth_failure(error);
                                auth_mgr
                                    .emit(
                                        "auth.failed",
                                        json!({ "reason": reason, "message": message }),
                                    )
                                    .await;
                            }
                            let outcome = result.map_err(|error| error.to_string());
                            let _ = outcome_tx.send(Some(outcome.clone()));
                            Ok::<_, std::convert::Infallible>(callback_response(outcome))
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
