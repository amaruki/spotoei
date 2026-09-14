use std::sync::Arc;

use serde_json::json;
use tracing::warn;

use super::super::constants::{now_ms, KEYMASTER_CLIENT_ID};
use super::super::manager::AuthManager;
use super::super::storage;
use super::super::types::{AccessToken, AuthError, AuthState, AuthStatus, Storage};

impl AuthManager {
    pub(super) async fn begin_mock(
        self: &Arc<Self>,
        streaming: bool,
    ) -> Result<AuthStatus, AuthError> {
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
}
