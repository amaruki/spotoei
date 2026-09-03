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

use super::constants::{
    html_error, html_escape, url_decode, HTML_SUCCESS, REDIRECT_PATH,
};
use super::manager::AuthManager;
use super::token::classify_auth_failure;
use super::types::{AuthError, AuthState};

impl AuthManager {
    pub(super) async fn serve_callback(
        self: Arc<Self>,
        listener: tokio::net::TcpListener,
        port: u16,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<(), AuthError> {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<String, AuthError>>(1);
        let timeout = tokio::time::sleep(std::time::Duration::from_secs(180));
        tokio::pin!(timeout);
        let result = loop {
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
                            "error": "OAuth authorization timed out after 3 minutes",
                            "recoverable": true,
                        }),
                    )
                    .await;
                    let mut s = self.state.lock().await;
                    s.state = AuthState::Unauthenticated;
                    s.pkce = None;
                    return Ok(());
                }
                msg = rx.recv() => break msg,
                accept = listener.accept() => {
                    let (stream, _addr) = match accept {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    let tx = tx.clone();
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let expected_state = {
                        let s = self.state.lock().await;
                        s.pkce.as_ref().map(|p| p.state.clone())
                    };
                    let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let tx = tx.clone();
                        let expected_state = expected_state.clone();
                        async move {
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
                            if Some(&state) != expected_state.as_ref() {
                                warn!("OAuth callback state mismatch, ignoring bogus request");
                                let html =
                                    html_error("State Mismatch", "Invalid OAuth state parameter. Please retry from Spotoei.");
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
                            let _ = tx.send(Ok(format!("{code}|{state}"))).await;
                            let resp = Response::builder()
                                .status(200)
                                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                                .body(Full::new(Bytes::from(HTML_SUCCESS)))
                                .unwrap();
                            Ok::<_, std::convert::Infallible>(resp)
                        }
                    });
                    tokio::spawn(async move {
                        let _ = http1::Builder::new().serve_connection(io, svc).await;
                    });
                }
            }
        };
        match result {
            Some(Ok(payload)) => {
                let mut parts = payload.splitn(2, '|');
                let code = parts.next().unwrap_or_default().to_string();
                let state = parts.next().unwrap_or_default().to_string();
                if let Err(e) = self.complete_flow(&code, &state, port).await {
                    warn!(error = %e, "auth complete flow failed");
                    let (reason, message) = classify_auth_failure(&e);
                    self.emit(
                        "auth.failed",
                        json!({ "reason": reason, "message": message }),
                    )
                    .await;
                }
            }
            Some(Err(e)) => {
                warn!(error = %e, "auth callback received error");
                {
                    let mut s = self.state.lock().await;
                    s.state = AuthState::Unauthenticated;
                }
                self.emit(
                    "auth.failed",
                    json!({ "reason": "other", "message": e.to_string() }),
                )
                .await;
            }
            None => {}
        }
        Ok(())
    }
}
