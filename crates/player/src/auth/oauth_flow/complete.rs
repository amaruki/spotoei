use serde_json::json;
use tracing::warn;

use super::super::manager::AuthManager;
use super::super::storage;
use super::super::types::{AuthError, AuthState, Storage};
use super::{
    account_conflict, reconcile_streaming_account, resolve_exchange_target,
    should_upgrade_web_account,
};

impl AuthManager {
    /// Claim and complete in one step. Only used by tests; the callback
    /// server claims explicitly so it can distinguish "duplicate tab" from
    /// "live transaction".
    #[cfg(test)]
    pub(in crate::auth) async fn complete_flow(
        &self,
        code: &str,
        state: &str,
        port: u16,
    ) -> Result<(), AuthError> {
        let Some((flow_seen, pkce)) = self.claim_pkce(state).await else {
            return Err(AuthError::OAuth("no in-flight PKCE tx".into()));
        };
        self.complete_claimed_flow(flow_seen, pkce, code, port)
            .await
    }

    /// Complete a PKCE transaction that `claim_pkce` has already taken out of
    /// the shared state. `flow_seen` is the generation captured at claim time:
    /// if a sign-out or newer login bumps it during the exchange, the
    /// credentials are discarded instead of resurrecting the old identity.
    pub(in crate::auth) async fn complete_claimed_flow(
        &self,
        flow_seen: u64,
        pkce: super::super::types::PkceTx,
        code: &str,
        port: u16,
    ) -> Result<(), AuthError> {
        let (exchange_cid, is_streaming_auth) =
            resolve_exchange_target(pkce.flow, &self.client_id.read().await.clone());

        let (at, _account_id) = match self
            .exchange_code_with_client(&exchange_cid, code, &pkce.verifier, "127.0.0.1", port)
            .await
        {
            Ok(ok) => ok,
            Err(e) => {
                warn!(error = %e, "auth code exchange failed; restoring previous session");
                // A newer login/sign-out may own the state now: never reset
                // its pending URL or auth state from this dead transaction.
                if self.flow_epoch() != flow_seen {
                    return Err(AuthError::Superseded);
                }
                let snap = {
                    let mut s = self.state.lock().await;
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
        // The token is real, but the identity it belongs to may no longer be
        // wanted: a sign-out, a client-ID reset, or a newer login started
        // while the exchange was on the wire. Never publish it then.
        if self.flow_epoch() != flow_seen {
            warn!("auth callback completed after being superseded; credentials discarded");
            return Err(AuthError::Superseded);
        }
        // Serialize the commit with sign-out, client-ID reset, and the
        // background streaming refresh: those take the same lock before
        // deleting credentials, so the commit either lands before the
        // deletion or is rejected by the epoch re-checks below.
        let _commit_guard = self.refresh_lock.lock().await;
        if self.flow_epoch() != flow_seen {
            warn!("auth callback superseded while waiting to commit; credentials discarded");
            return Err(AuthError::Superseded);
        }
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
            if self.flow_epoch() != flow_seen {
                warn!("streaming login superseded before commit; credentials discarded");
                return Err(AuthError::Superseded);
            }
            let persisted = storage::save_streaming_session(&token_for_store)
                .await
                .is_ok();
            storage::delete_librespot_credentials_cache();
            let snap = {
                let mut s = self.state.lock().await;
                if self.flow_epoch() != flow_seen {
                    return Err(AuthError::Superseded);
                }
                s.streaming = Some(token_for_store);
                s.storage = if persisted {
                    Storage::Keyring
                } else {
                    Storage::Memory
                };
                s.pkce = None;
                s.last_auth_url = None;
                s.state = AuthState::Authenticated;
                self.bump_epoch();
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

        // One critical section publishes the new identity and decides the fate
        // of the previous streaming credentials. The playback epoch is bumped
        // before the snapshot becomes observable, so no observer can pair the
        // new account with the old playback session.
        let (snap, dropped_streaming) = {
            let mut s = self.state.lock().await;
            if self.flow_epoch() != flow_seen {
                warn!("web login superseded before commit; credentials discarded");
                return Err(AuthError::Superseded);
            }
            let previous_streaming = s.streaming.take();
            let keep_streaming = previous_streaming
                .as_ref()
                .is_some_and(|token| token.account_id == account_id);
            s.streaming = if keep_streaming {
                previous_streaming.clone()
            } else {
                None
            };
            s.current = Some(at);
            s.state = AuthState::Authenticated;
            s.pkce = None;
            s.last_auth_url = None;
            s.storage = Storage::Memory;
            let dropped = if keep_streaming {
                None
            } else {
                // Delete the cache before the epoch bump makes the new
                // identity visible: a rebuild triggered by the new epoch must
                // not resume credentials belonging to the previous account.
                storage::delete_librespot_credentials_cache();
                self.bump_epoch();
                previous_streaming
            };
            (self.snapshot_locked(&s, None), dropped)
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
        if let Some(previous) = dropped_streaming {
            storage::delete_streaming_session(Some(previous.account_id.as_str())).await;
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
