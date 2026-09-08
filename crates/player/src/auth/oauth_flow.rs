use std::sync::Arc;

use serde_json::json;
use tokio::sync::oneshot;
use tracing::warn;

use super::constants::{
    generate_state, generate_verifier, now_ms, s256_challenge, KEYMASTER_CLIENT_ID, KEYMASTER_PORT,
    NCSPOT_CLIENT_ID, REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
use super::manager::AuthManager;
use super::storage;
use super::types::{AccessToken, AuthError, AuthFlow, AuthState, AuthStatus, PkceTx, Storage};

/// Decide how a completed PKCE callback is stored: which client the code
/// is exchanged for, and whether the token lands in the streaming store.
/// The flow recorded at `begin` time wins — never sniff URLs, so a Web
/// login stays a Web login even when the configured client is Keymaster.
pub const STREAMING_SCOPES: &str = "streaming user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-read-playback-position user-top-read user-read-recently-played";

pub(super) fn resolve_exchange_target(
    flow: AuthFlow,
    configured_client_id: &str,
) -> (String, bool) {
    match flow {
        AuthFlow::Streaming => (KEYMASTER_CLIENT_ID.to_string(), true),
        AuthFlow::Web => (configured_client_id.to_string(), false),
    }
}

impl AuthManager {
    pub async fn begin(
        self: &Arc<Self>,
        scopes: Option<Vec<String>>,
    ) -> Result<AuthStatus, AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.begin_mock().await;
        }
        let client_id = self.client_id.read().await.clone();
        if client_id.is_empty() {
            return Err(AuthError::MissingClientId);
        }
        self.cancel_in_flight().await;

        let verifier = generate_verifier();
        let challenge = s256_challenge(&verifier);
        let csrf = generate_state();

        let is_login_flow = client_id == KEYMASTER_CLIENT_ID || client_id == NCSPOT_CLIENT_ID;
        let default_port = KEYMASTER_PORT; // 8989
        let port: u16 = std::env::var("SPOTOEI_REDIRECT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(default_port);

        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            Ok(l) => l,
            Err(e) => {
                let snap = {
                    let mut s = self.state.lock().await;
                    s.pkce = None;
                    s.state = AuthState::Unauthenticated;
                    self.snapshot_locked(&s, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(AuthError::Http(format!("bind 127.0.0.1:{port}: {e}")));
            }
        };
        let bound_port = listener
            .local_addr()
            .map_err(|e| AuthError::Http(format!("local_addr: {e}")))?
            .port();
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
            s.pkce = Some(PkceTx {
                verifier: verifier.clone(),
                state: csrf.clone(),
                flow: AuthFlow::Web,
            });
            s.last_auth_url = Some(url.clone());
            s.state = AuthState::Authenticating;
            self.snapshot_locked(&s, Some(url))
        };

        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }

        let (cancel_tx, cancel_rx) = oneshot::channel();
        *self.cancel.lock().await = Some(cancel_tx);
        let this = Arc::clone(self);
        let handle = tokio::spawn(async move {
            if let Err(e) = this.serve_callback(listener, bound_port, cancel_rx).await {
                warn!(error = %e, "auth callback server failed");
            }
        });
        *self.join_handle.lock().await = Some(handle);

        Ok(snap)
    }

    pub async fn has_streaming_session(&self) -> bool {
        if let Ok(Some(st)) = storage::load_streaming_session().await {
            !st.access_token.is_empty()
        } else {
            false
        }
    }

    pub async fn begin_streaming(self: &Arc<Self>) -> Result<AuthStatus, AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.begin_mock().await;
        }
        self.cancel_in_flight().await;

        let verifier = generate_verifier();
        let challenge = s256_challenge(&verifier);
        let csrf = generate_state();

        let port = KEYMASTER_PORT; // 8989
        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            Ok(l) => l,
            Err(e) => {
                let snap = {
                    let mut s = self.state.lock().await;
                    s.pkce = None;
                    self.snapshot_locked(&s, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(AuthError::Http(format!("bind 127.0.0.1:{port}: {e}")));
            }
        };
        let bound_port = listener
            .local_addr()
            .map_err(|e| AuthError::Http(format!("local_addr: {e}")))?
            .port();
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
            s.pkce = Some(PkceTx {
                verifier: verifier.clone(),
                state: csrf.clone(),
                flow: AuthFlow::Streaming,
            });
            s.last_auth_url = Some(url.clone());
            s.state = AuthState::Authenticating;
            self.snapshot_locked(&s, Some(url))
        };
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }

        let this = Arc::clone(self);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        *self.cancel.lock().await = Some(cancel_tx);
        let handle = tokio::spawn(async move {
            if let Err(e) = this.serve_callback(listener, bound_port, cancel_rx).await {
                warn!(error = %e, "auth callback server failed");
            }
        });
        *self.join_handle.lock().await = Some(handle);
        Ok(snap)
    }
    async fn begin_mock(self: &Arc<Self>) -> Result<AuthStatus, AuthError> {
        let refresh = std::env::var("SPOTOEI_MOCK_REFRESH_TOKEN")
            .unwrap_or_else(|_| format!("mock-refresh-{}", now_ms()));
        let access = format!("mock-access-{}", now_ms());
        let account =
            std::env::var("SPOTOEI_MOCK_ACCOUNT_ID").unwrap_or_else(|_| "mock-account".into());
        let at = AccessToken {
            access_token: access,
            refresh_token: refresh.clone(),
            expires_at: now_ms() + 3600_000,
            account_id: account,
            scopes: self.scopes.clone(),
        };
        let saved_account_id = at.account_id.clone();
        let saved_scopes = at.scopes.clone();
        let (snap, account_id, scopes) = match storage::save_session(&at).await {
            Ok(()) => {
                let mut s = self.state.lock().await;
                s.storage = Storage::Keyring;
                s.current = Some(at);
                s.state = AuthState::Authenticated;
                let snap = self.snapshot_locked(&s, None);
                (snap, saved_account_id, saved_scopes)
            }
            Err(e) => {
                warn!(error = %e, "mock auth: session save failed; staying in-memory");
                let mut s = self.state.lock().await;
                s.storage = Storage::Memory;
                s.current = Some(at);
                s.state = AuthState::Authenticated;
                let snap = self.snapshot_locked(&s, None);
                (snap, saved_account_id, saved_scopes)
            }
        };
        storage::delete_librespot_credentials_cache();
        self.bump_epoch();
        self.emit(
            "auth.changed",
            serde_json::to_value(&snap)
                .map_err(|e| AuthError::OAuth(format!("snapshot encode: {e}")))?,
        )
        .await;
        self.emit(
            "auth.completed",
            json!({
                "accountId": account_id,
                "scopes": scopes,
            }),
        )
        .await;
        Ok(snap)
    }

    pub async fn logout(&self) -> Result<AuthStatus, AuthError> {
        let (snap, account_id) = {
            let mut s = self.state.lock().await;
            let account_id = s.current.as_ref().map(|at| at.account_id.clone());
            s.current = None;
            s.pkce = None;
            s.last_auth_url = None;
            s.state = AuthState::Unauthenticated;
            (self.snapshot_locked(&s, None), account_id)
        };
        if let Some(account_id) = account_id {
            if let Err(e) = storage::delete_session(&account_id).await {
                warn!(error = %e, "session delete failed");
            }
        }
        // Drop the playback credentials too: otherwise the next session setup
        // silently resumes the previous user's connection.
        storage::delete_streaming_session().await;
        storage::delete_librespot_credentials_cache();
        self.bump_epoch();
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
        Ok(snap)
    }

    pub(super) async fn complete_flow(
        &self,
        code: &str,
        state: &str,
        port: u16,
    ) -> Result<(), AuthError> {
        let pkce = {
            let s = self.state.lock().await;
            s.pkce.clone()
        };
        let pkce = pkce.ok_or_else(|| AuthError::OAuth("no in-flight PKCE tx".into()))?;
        if pkce.state != state {
            return Err(AuthError::OAuth("state mismatch".into()));
        }
        let (exchange_cid, is_streaming_auth) =
            resolve_exchange_target(pkce.flow, &self.client_id.read().await.clone());

        let (at, _account_id) = match self
            .exchange_code_with_client(&exchange_cid, code, &pkce.verifier, "127.0.0.1", port)
            .await
        {
            Ok(ok) => ok,
            Err(e) => {
                warn!(error = %e, "auth code exchange failed; restoring previous session");
                let snap = {
                    let mut s = self.state.lock().await;
                    s.pkce = None;
                    s.last_auth_url = None;
                    // A streaming top-up over a Web login falls back to the
                    // surviving Authenticated session; a cold login with no
                    // session returns to Unauthenticated. Either way the dead
                    // transaction is gone, so the next press starts fresh
                    // instead of stranding the UI on "authenticating".
                    s.state = if s.current.is_some() {
                        AuthState::Authenticated
                    } else {
                        AuthState::Unauthenticated
                    };
                    self.snapshot_locked(&s, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(e);
            }
        };
        let account_id = at.account_id.clone();
        let scopes = at.scopes.clone();
        let token_for_store = at.clone();

        if is_streaming_auth {
            let _ = storage::save_streaming_session(&token_for_store).await;
            storage::delete_librespot_credentials_cache();
            self.bump_epoch();
            let snap = {
                let mut s = self.state.lock().await;
                s.pkce = None;
                s.last_auth_url = None;
                self.snapshot_locked(&s, None)
            };
            if let Ok(value) = serde_json::to_value(&snap) {
                self.emit("auth.changed", value).await;
            }
            tracing::info!("streaming login completed for account {account_id}");
            self.emit(
                "auth.completed",
                json!({
                    "accountId": account_id,
                    "scopes": scopes,
                    "streaming": true,
                }),
            )
            .await;
            return Ok(());
        }

        let snap = {
            let mut s = self.state.lock().await;
            s.current = Some(at);
            s.state = AuthState::Authenticated;
            s.pkce = None;
            s.last_auth_url = None;
            s.storage = Storage::Memory;
            self.snapshot_locked(&s, None)
        };
        match storage::save_session(&token_for_store).await {
            Ok(()) => {
                let snap = {
                    let mut s = self.state.lock().await;
                    s.storage = Storage::Keyring;
                    self.snapshot_locked(&s, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
            }
            Err(AuthError::KeyringUnavailable(_)) => {
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
            }
            Err(e) => {
                warn!(error = %e, "session save on complete failed");
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
            }
        }
        // A fresh login belongs to a (possibly different) user: drop the old
        // playback credentials and force the engine to reconnect.
        storage::delete_librespot_credentials_cache();
        self.bump_epoch();
        tracing::info!("web login completed for account {account_id}");
        self.emit(
            "auth.completed",
            json!({
                "accountId": account_id,
                "scopes": scopes,
            }),
        )
        .await;
        Ok(())
    }
}
