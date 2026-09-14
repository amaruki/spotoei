use tracing::warn;

use super::super::manager::AuthManager;
use super::super::storage;
use super::super::types::{AuthError, AuthState, AuthStatus};

impl AuthManager {
    pub async fn logout(&self) -> Result<AuthStatus, AuthError> {
        // Serialize with the background streaming refresh: a refresh that
        // completes after this point would rewrite the credentials the user
        // just asked to delete.
        let _refresh_guard = self.refresh_lock.lock().await;
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
            // Bump inside the same critical section: a callback that already
            // passed its epoch check must observe the change before it can
            // commit a token.
            self.bump_epoch();
            self.bump_flow_epoch();
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
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
        Ok(snap)
    }
}
