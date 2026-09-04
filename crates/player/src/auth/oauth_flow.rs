use std::sync::Arc;

use serde_json::json;
use tokio::sync::oneshot;
use tracing::warn;

use super::constants::{
    generate_state, generate_verifier, now_ms, s256_challenge, KEYMASTER_CLIENT_ID, KEYMASTER_PORT,
    REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
use super::manager::AuthManager;
use super::storage;
use super::types::{AccessToken, AuthError, AuthState, AuthStatus, PkceTx, Storage};

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
        let (cancel_tx, cancel_rx) = oneshot::channel();
        *self.cancel.lock().await = Some(cancel_tx);

        let mut s = self.state.lock().await;
        let verifier = generate_verifier();
        let challenge = s256_challenge(&verifier);
        let csrf = generate_state();
        s.pkce = Some(PkceTx {
            verifier: verifier.clone(),
            state: csrf.clone(),
        });
        s.last_auth_url = None;
        s.state = AuthState::Authenticating;

        let is_keymaster = client_id == KEYMASTER_CLIENT_ID;
        let default_port = if is_keymaster { KEYMASTER_PORT } else { 8989 };
        let port: u16 = std::env::var("SPOTOEI_REDIRECT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(default_port);

        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            Ok(l) => l,
            Err(e) => {
                s.pkce = None;
                s.state = AuthState::Unauthenticated;
                let snap = self.snapshot_locked(&s, None);
                drop(s);
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                let _ = self.cancel.lock().await.take();
                return Err(AuthError::Http(format!("bind 127.0.0.1:{port}: {e}")));
            }
        };
        let bound_port = listener
            .local_addr()
            .map_err(|e| AuthError::Http(format!("local_addr: {e}")))?
            .port();
        let redirect_path = if is_keymaster {
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
        s.last_auth_url = Some(url.clone());

        let snap = self.snapshot_locked(&s, Some(url));
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }

        let this = Arc::clone(self);
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
        let mut s = self.state.lock().await;
        if let Some(at) = s.current.as_ref() {
            if let Err(e) = storage::delete_session(&at.account_id).await {
                warn!(error = %e, "session delete failed");
            }
        }
        s.current = None;
        s.pkce = None;
        s.last_auth_url = None;
        s.state = AuthState::Unauthenticated;
        let snap = self.snapshot_locked(&s, None);
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
        let (at, _account_id) = self
            .exchange_code(code, &pkce.verifier, "127.0.0.1", port)
            .await?;
        let account_id = at.account_id.clone();
        let scopes = at.scopes.clone();
        let snap = {
            let mut s = self.state.lock().await;
            s.current = Some(at);
            s.state = AuthState::Authenticated;
            s.pkce = None;
            s.last_auth_url = None;
            s.storage = Storage::Keyring;
            if let Err(e) = storage::save_session(s.current.as_ref().expect("just set")).await {
                warn!(error = %e, "session save on complete failed");
            }
            self.snapshot_locked(&s, None)
        };
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
        Ok(())
    }
}
