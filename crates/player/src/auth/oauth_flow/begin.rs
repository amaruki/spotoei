use std::sync::Arc;

use tokio::sync::oneshot;
use tracing::warn;

use super::super::constants::{
    generate_state, generate_verifier, s256_challenge, KEYMASTER_CLIENT_ID, KEYMASTER_PORT,
    NCSPOT_CLIENT_ID, REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
use super::super::manager::AuthManager;
use super::super::storage;
use super::super::types::{AuthError, AuthFlow, AuthState, AuthStatus, PkceTx};
use super::STREAMING_SCOPES;

impl AuthManager {
    /// Reserve the loopback port and return the bound listener. Serving starts
    /// only after the PKCE transaction is recorded, so a callback can never
    /// reach a listener whose state/URL are still unset.
    async fn bind_callback_listener(
        self: &Arc<Self>,
        port: u16,
        expected_state: &str,
    ) -> Result<(tokio::net::TcpListener, u16), AuthError> {
        self.cancel_in_flight().await;
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
            .await
            .map_err(|error| AuthError::Http(format!("bind 127.0.0.1:{port}: {error}")))?;
        let bound_port = listener
            .local_addr()
            .map_err(|error| AuthError::Http(format!("local_addr: {error}")))?
            .port();
        *self.bound_port.lock().await = Some(bound_port);
        *self.listener_state.lock().await = Some(expected_state.to_string());
        Ok((listener, bound_port))
    }

    async fn serve_bound_callback(
        self: &Arc<Self>,
        listener: tokio::net::TcpListener,
        bound_port: u16,
        expected_state: String,
    ) {
        let (cancel_tx, cancel_rx) = oneshot::channel();
        *self.cancel.lock().await = Some(cancel_tx);
        tracing::info!(
            state = %expected_state,
            port = bound_port,
            "auth callback listener armed"
        );
        let this = Arc::clone(self);
        let handle = tokio::spawn(async move {
            if let Err(error) = this
                .serve_callback(listener, bound_port, expected_state, cancel_rx)
                .await
            {
                warn!(error = %error, "auth callback server failed");
            }
        });
        *self.join_handle.lock().await = Some(handle);
    }

    pub async fn begin(
        self: &Arc<Self>,
        scopes: Option<Vec<String>>,
    ) -> Result<AuthStatus, AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.begin_mock(false).await;
        }
        let client_id = self.client_id.read().await.clone();
        if client_id.is_empty() {
            return Err(AuthError::MissingClientId);
        }
        let verifier = generate_verifier();
        let challenge = s256_challenge(&verifier);
        let csrf = generate_state();

        let is_login_flow = client_id == KEYMASTER_CLIENT_ID || client_id == NCSPOT_CLIENT_ID;
        let default_port = KEYMASTER_PORT; // 8989
        let port: u16 = std::env::var("SPOTOEI_REDIRECT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(default_port);

        let (listener, bound_port) = match self.bind_callback_listener(port, &csrf).await {
            Ok(bound) => bound,
            Err(error) => {
                let snap = {
                    let mut state = self.state.lock().await;
                    state.clear_all_pkce();
                    state.last_auth_url = None;
                    state.state = if state.current.is_some() {
                        AuthState::Authenticated
                    } else {
                        AuthState::Unauthenticated
                    };
                    self.snapshot_locked(&state, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(error);
            }
        };
        let redirect_path = if is_login_flow {
            "/login"
        } else {
            REDIRECT_PATH
        };
        let redirect_uri = format!("http://127.0.0.1:{bound_port}{redirect_path}");

        let scope_str = scopes.unwrap_or_else(|| self.scopes.clone()).join(" ");
        let url = format!(
            "{SPOTIFY_ACCOUNTS}/authorize?client_id={cid}&response_type=code&redirect_uri={ru}&code_challenge_method=S256&code_challenge={cc}&state={st}&scope={sc}",
            cid = urlencoding::encode(&client_id),
            ru = urlencoding::encode(&redirect_uri),
            cc = urlencoding::encode(&challenge),
            st = urlencoding::encode(&csrf),
            sc = urlencoding::encode(&scope_str),
        );
        let snap = {
            let mut s = self.state.lock().await;
            s.clear_all_pkce();
            s.pkce = Some(PkceTx {
                verifier: verifier.clone(),
                state: csrf.clone(),
                flow: AuthFlow::Web,
            });
            s.last_auth_url = Some(url.clone());
            s.state = AuthState::Authenticating;
            self.bump_flow_epoch();
            self.snapshot_locked(&s, Some(url))
        };

        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
        self.serve_bound_callback(listener, bound_port, csrf).await;

        Ok(snap)
    }

    pub async fn has_streaming_session(&self) -> bool {
        let s = self.state.lock().await;
        let account_id = s.current.as_ref().map(|token| token.account_id.clone());
        let in_memory = s.streaming.clone();
        drop(s);
        let Some(account_id) = account_id else {
            return false;
        };
        if let Some(token) = in_memory {
            return token.account_id == account_id
                && (!token.access_token.is_empty() || !token.refresh_token.is_empty());
        }
        storage::load_streaming_session_for(&account_id)
            .await
            .map(|token| token.is_some_and(|token| token.account_id == account_id))
            .unwrap_or(false)
    }

    pub async fn begin_streaming(self: &Arc<Self>) -> Result<AuthStatus, AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.begin_mock(true).await;
        }
        if !self.has_current_session().await {
            return Err(AuthError::NotAuthenticated);
        }
        let verifier = generate_verifier();
        let challenge = s256_challenge(&verifier);
        let csrf = generate_state();
        // The Keymaster client only accepts its registered ports; tests may
        // override the port so the suite never fights a running app for 8989.
        #[cfg(test)]
        let port = std::env::var("SPOTOEI_REDIRECT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(KEYMASTER_PORT);
        #[cfg(not(test))]
        let port = KEYMASTER_PORT; // 8989
        let (listener, bound_port) = match self.bind_callback_listener(port, &csrf).await {
            Ok(bound) => bound,
            Err(error) => {
                let snap = {
                    let mut state = self.state.lock().await;
                    state.clear_all_pkce();
                    state.last_auth_url = None;
                    state.state = AuthState::Authenticated;
                    self.snapshot_locked(&state, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(error);
            }
        };
        let redirect_uri = format!("http://127.0.0.1:{bound_port}/login");
        let scope_str = STREAMING_SCOPES;
        let url = format!(
            "{SPOTIFY_ACCOUNTS}/authorize?client_id={cid}&response_type=code&redirect_uri={ru}&code_challenge_method=S256&code_challenge={cc}&state={st}&scope={sc}",
            cid = urlencoding::encode(KEYMASTER_CLIENT_ID),
            ru = urlencoding::encode(&redirect_uri),
            cc = urlencoding::encode(&challenge),
            st = urlencoding::encode(&csrf),
            sc = urlencoding::encode(scope_str),
        );
        let snap = {
            let mut s = self.state.lock().await;
            s.clear_all_pkce();
            s.pkce = Some(PkceTx {
                verifier: verifier.clone(),
                state: csrf.clone(),
                flow: AuthFlow::Streaming,
            });
            s.last_auth_url = Some(url.clone());
            s.state = if s.current.is_some() {
                AuthState::Authenticated
            } else {
                AuthState::Authenticating
            };
            self.bump_flow_epoch();
            self.snapshot_locked(&s, Some(url))
        };
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
        self.serve_bound_callback(listener, bound_port, csrf).await;

        Ok(snap)
    }
}
