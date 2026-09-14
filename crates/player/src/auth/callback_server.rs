mod handlers;

use std::sync::Arc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use tokio::sync::oneshot;
use tracing::warn;

use super::manager::AuthManager;
use super::types::{AuthError, AuthState};

use handlers::handle_callback;

impl AuthManager {
    pub(super) async fn serve_callback(
        self: Arc<Self>,
        listener: tokio::net::TcpListener,
        port: u16,
        expected_state: String,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<(), AuthError> {
        let timeout = tokio::time::sleep(std::time::Duration::from_secs(300));
        tokio::pin!(timeout);
        let (claimed_tx, mut claimed_rx) = tokio::sync::mpsc::channel::<()>(1);
        loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    break;
                }
                _ = &mut timeout => {
                    // Only clear the transaction this listener owns. A newer
                    // login must survive an older listener's timeout.
                    let owned = self.state.lock().await.find_pkce(&expected_state).is_some();
                    if owned {
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
                    }
                    break;
                }
                _ = claimed_rx.recv() => {
                    // The callback for this flow is in hand; the connection
                    // task owns completion from here. Close the listener so
                    // the port is free for the next login phase.
                    break;
                }
                accept = listener.accept() => {
                    let (stream, _addr) = match accept {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let auth_mgr = Arc::clone(&self);
                    let connection_state = expected_state.clone();
                    let connection_claimed_tx = claimed_tx.clone();
                    let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let auth_mgr = Arc::clone(&auth_mgr);
                        let state = connection_state.clone();
                        let claimed_tx = connection_claimed_tx.clone();
                        async move { handle_callback(auth_mgr, port, req, &state, claimed_tx).await }
                    });
                    tokio::spawn(async move {
                        let _ = http1::Builder::new().serve_connection(io, svc).await;
                    });
                }
            }
        }
        // Release the listener slot only if a newer flow has not taken it.
        let owns = {
            let listener_state = self.listener_state.lock().await;
            listener_state.as_deref() == Some(expected_state.as_str())
        };
        if owns {
            *self.bound_port.lock().await = None;
            let mut listener_state = self.listener_state.lock().await;
            if listener_state.as_deref() == Some(expected_state.as_str()) {
                *listener_state = None;
            }
        }
        Ok(())
    }
}
