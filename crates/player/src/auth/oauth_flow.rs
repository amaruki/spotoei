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
pub const STREAMING_SCOPES: &str = "streaming user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-read-playback-position user-top-read user-read-recently-played user-read-private";

pub(super) fn resolve_exchange_target(
    flow: AuthFlow,
    configured_client_id: &str,
) -> (String, bool) {
    match flow {
        AuthFlow::Streaming => (KEYMASTER_CLIENT_ID.to_string(), true),
        AuthFlow::Web => (configured_client_id.to_string(), false),
    }
}

/// Whether two account identities conflict. `None` means that an identity is
/// not known. Only two different, known account IDs conflict.
pub(super) fn account_conflict(stored: Option<&str>, fresh: &str) -> bool {
    // "default" is a placeholder generated when /v1/me fails; it must never
    // be treated as a conflict with a known real account.
    matches!(stored, Some(id) if id != fresh && id != "default" && fresh != "default")
}

/// When /v1/me could not be reached (missing scope, rate-limiting, offline),
/// the Keymaster token exchange assigns "default". If an authenticated Web
/// session already exists, bind the streaming token to that known user instead
/// of leaving it orphaned under the placeholder.
pub(super) fn reconcile_streaming_account<'a>(
    web_account: Option<&'a str>,
    streaming_account: &'a str,
) -> &'a str {
    if streaming_account == "default" {
        if let Some(web) = web_account {
            if !web.trim().is_empty() {
                return web;
            }
        }
    }
    streaming_account
}

pub(super) fn should_upgrade_web_account(web_account: Option<&str>, resolved: &str) -> bool {
    web_account == Some("default") && resolved != "default"
}

impl AuthManager {
    async fn start_callback_listener(
        self: &Arc<Self>,
        port: u16,
        expected_state: String,
    ) -> Result<u16, AuthError> {
        self.cancel_in_flight().await;
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
            .await
            .map_err(|error| AuthError::Http(format!("bind 127.0.0.1:{port}: {error}")))?;
        let bound_port = listener
            .local_addr()
            .map_err(|error| AuthError::Http(format!("local_addr: {error}")))?
            .port();
        *self.bound_port.lock().await = Some(bound_port);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        *self.cancel.lock().await = Some(cancel_tx);
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
        Ok(bound_port)
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

        let bound_port = match self.start_callback_listener(port, csrf.clone()).await {
            Ok(bound_port) => bound_port,
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
            self.snapshot_locked(&s, Some(url))
        };

        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }

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
        let port = KEYMASTER_PORT; // 8989
        let bound_port = match self.start_callback_listener(port, csrf.clone()).await {
            Ok(bound_port) => bound_port,
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
            self.snapshot_locked(&s, Some(url))
        };
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }

        Ok(snap)
    }
    async fn begin_mock(self: &Arc<Self>, streaming: bool) -> Result<AuthStatus, AuthError> {
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
            client_id: if streaming {
                KEYMASTER_CLIENT_ID.to_string()
            } else {
                self.client_id.read().await.clone()
            },
        };
        let saved_account_id = at.account_id.clone();
        let saved_scopes = at.scopes.clone();
        let save = if streaming {
            storage::save_streaming_session(&at).await
        } else {
            storage::save_session(&at).await
        };
        let (snap, account_id, scopes) = match save {
            Ok(()) => {
                let mut s = self.state.lock().await;
                s.storage = Storage::Keyring;
                if streaming {
                    s.streaming = Some(at);
                } else {
                    s.current = Some(at);
                }
                s.state = AuthState::Authenticated;
                let snap = self.snapshot_locked(&s, None);
                (snap, saved_account_id, saved_scopes)
            }
            Err(e) => {
                warn!(error = %e, "mock auth: session save failed; staying in-memory");
                let mut s = self.state.lock().await;
                s.storage = Storage::Memory;
                if streaming {
                    s.streaming = Some(at);
                } else {
                    s.current = Some(at);
                }
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
                "streaming": streaming,
            }),
        )
        .await;
        Ok(snap)
    }

    pub async fn logout(&self) -> Result<AuthStatus, AuthError> {
        self.cancel_in_flight().await;
        storage::purge_legacy_file_credentials();
        let (snap, account_id) = {
            let mut s = self.state.lock().await;
            let account_id = s.current.as_ref().map(|at| at.account_id.clone());
            s.current = None;
            s.streaming = None;
            s.clear_all_pkce();
            s.last_auth_url = None;
            s.state = AuthState::Unauthenticated;
            (self.snapshot_locked(&s, None), account_id)
        };
        if let Some(account_id) = account_id.as_deref() {
            if let Err(e) = storage::delete_session(account_id).await {
                warn!(error = %e, "session delete failed");
            }
        }
        // Drop the playback credentials too: otherwise the next session setup
        // silently resumes the previous user's connection.
        storage::delete_streaming_session(account_id.as_deref()).await;
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
            let mut s = self.state.lock().await;
            s.remove_pkce(state)
        };
        let pkce = pkce.ok_or_else(|| AuthError::OAuth("no in-flight PKCE tx".into()))?;
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
                    s.remove_pkce(state);
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
            let web_account = self
                .state
                .lock()
                .await
                .current
                .as_ref()
                .map(|token| token.account_id.clone());
            let account_id =
                reconcile_streaming_account(web_account.as_deref(), &account_id).to_string();
            let mut token_for_store = at.clone();
            token_for_store.account_id = account_id.clone();
            // Only a genuinely different account is a conflict. A placeholder
            // identity is reconciled below before both credentials are stored.
            if account_conflict(web_account.as_deref(), &account_id) {
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
                return Err(AuthError::OAuth(
                    "streaming authorization belongs to a different Spotify account".into(),
                ));
            }
            let upgraded_web_token =
                if should_upgrade_web_account(web_account.as_deref(), &account_id) {
                    let mut state = self.state.lock().await;
                    state.current.as_mut().map(|token| {
                        token.account_id.clone_from(&account_id);
                        token.clone()
                    })
                } else {
                    None
                };
            if let Some(web_token) = upgraded_web_token {
                if let Err(error) = storage::save_session(&web_token).await {
                    warn!(error = %error, "upgraded Web account identity could not be persisted");
                }
            }
            let persisted = storage::save_streaming_session(&token_for_store)
                .await
                .is_ok();
            storage::delete_librespot_credentials_cache();
            self.bump_epoch();
            let snap = {
                let mut s = self.state.lock().await;
                s.streaming = Some(token_for_store);
                s.storage = if persisted {
                    Storage::Keyring
                } else {
                    Storage::Memory
                };
                s.pkce = None;
                s.last_auth_url = None;
                s.state = AuthState::Authenticated;
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
        // playback credentials and force the engine to reconnect. A streaming
        // session for the same account can survive explicit Web reauthorization.
        let previous_streaming = self.state.lock().await.streaming.take();
        let keep_streaming = previous_streaming
            .as_ref()
            .is_some_and(|token| token.account_id == account_id);
        if keep_streaming {
            self.state.lock().await.streaming = previous_streaming;
        } else {
            storage::delete_streaming_session(
                previous_streaming
                    .as_ref()
                    .map(|token| token.account_id.as_str()),
            )
            .await;
            storage::delete_librespot_credentials_cache();
            self.bump_epoch();
        }
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
