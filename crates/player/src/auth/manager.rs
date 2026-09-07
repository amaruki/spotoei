use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::warn;

use crate::event;

use super::constants::{now_ms, DEFAULT_SCOPES};
use super::storage;
use super::types::{AuthState, AuthStatus, InnerState, Storage};

pub struct AuthManager {
    pub(super) client_id: RwLock<String>,
    pub(super) scopes: Vec<String>,

    /// Current authoritative state.
    pub(super) state: Mutex<InnerState>,
    /// In-flight single-flight refresh lock.
    pub(super) refresh_lock: Mutex<()>,
    /// Playback session generation. Bumped whenever the auth identity changes
    /// (logout, new login, client ID reset) so the playback engine drops a
    /// session that belongs to the previous user instead of resuming it.
    session_epoch: AtomicU64,
    /// Sink for outgoing protocol events.
    pub(super) events: mpsc::Sender<String>,
    /// Cancellation for the in-flight loopback callback server, if any.
    pub(super) cancel: Mutex<Option<oneshot::Sender<()>>>,
    /// `JoinHandle` for the in-flight loopback callback server, if any.
    /// Held so the sidecar main loop can abort + await it on shutdown.
    pub(super) join_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl AuthManager {
    /// Build a new auth manager. `client_id` MUST be supplied via config.
    /// `events` receives protocol-formatted `auth.*` event lines.
    pub fn new(client_id: String, events: mpsc::Sender<String>) -> Self {
        Self {
            client_id: RwLock::new(client_id),
            scopes: DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect(),
            state: Mutex::new(InnerState {
                state: AuthState::Unauthenticated,
                storage: Storage::Unavailable,
                current: None,
                pkce: None,
                last_auth_url: None,
            }),
            refresh_lock: Mutex::new(()),
            session_epoch: AtomicU64::new(0),
            events,
            cancel: Mutex::new(None),
            join_handle: Mutex::new(None),
        }
    }

    /// Update the client ID dynamically without restarting the player.
    /// A token minted for one client is rejected under another, so any
    /// existing session is dropped and playback is told to reconnect.
    pub async fn set_client_id(&self, client_id: String) {
        *self.client_id.write().await = client_id;
        let snap = {
            let mut s = self.state.lock().await;
            s.current = None;
            s.pkce = None;
            s.last_auth_url = None;
            s.state = AuthState::Unauthenticated;
            self.snapshot_locked(&s, None)
        };
        self.bump_epoch();
        storage::delete_librespot_credentials_cache();
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
    }

    /// Playback generation for the current auth identity.
    pub fn session_epoch(&self) -> u64 {
        self.session_epoch.load(Ordering::SeqCst)
    }

    pub(super) fn bump_epoch(&self) {
        self.session_epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// Whether an auth session is currently held (used to fail fast instead
    /// of resurrecting a stale playback session from disk).
    pub async fn has_current_session(&self) -> bool {
        self.state.lock().await.current.is_some()
    }

    /// Force the next `get_web_token` to refresh instead of serving the
    /// cached access token. Called after the Web API rejects a token with
    /// HTTP 401: the token is invalid even though its expiry is in the
    /// future, so the player cache must not serve it again.
    pub async fn invalidate_token(&self) {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            let mut s = self.state.lock().await;
            if let Some(at) = s.current.as_mut() {
                at.access_token = format!("mock-access-{}-{}", now_ms(), crate::next_event_seq());
                at.expires_at = now_ms() + 3600_000;
            }
            return;
        }
        let mut s = self.state.lock().await;
        if let Some(at) = s.current.as_mut() {
            at.expires_at = 0;
        }
    }

    /// Get current client ID.
    pub async fn client_id(&self) -> String {
        self.client_id.read().await.clone()
    }

    /// Reserve and return the next monotonic event sequence number.
    pub fn next_seq(&self) -> u64 {
        crate::next_event_seq()
    }

    pub(super) async fn emit(&self, name: &str, data: Value) {
        let seq = self.next_seq();
        let line = event(name, seq, data);
        let _ = self.events.send(line).await;
    }

    /// Cancel any in-flight loopback callback server and join its task.
    pub async fn cancel_in_flight(&self) {
        if let Some(tx) = self.cancel.lock().await.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.join_handle.lock().await.take() {
            handle.abort();
            let _ = handle.await;
        }
    }

    /// Determine storage tier and load any persisted refresh material.
    /// Returns the active status snapshot after hydration.
    pub async fn hydrate(&self) -> AuthStatus {
        let (storage, current) = match storage::load_session().await {
            Ok(Some(at)) => (Storage::Keyring, Some(at)),
            Ok(None) => (Storage::Keyring, None),
            Err(e) => {
                warn!(error = %e, "storage unavailable; auth will be in-memory only");
                (Storage::Memory, None)
            }
        };
        let snap = {
            let mut s = self.state.lock().await;
            s.storage = storage;
            if let Some(at) = current {
                s.current = Some(at);
                s.state = AuthState::Authenticated;
            } else {
                s.state = AuthState::Unauthenticated;
            }
            self.snapshot_locked(&s, None)
        };
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
        snap
    }

    pub async fn status(&self) -> AuthStatus {
        let s = self.state.lock().await;
        self.snapshot_locked(&s, s.last_auth_url.clone())
    }

    pub(super) fn snapshot_locked(&self, s: &InnerState, auth_url: Option<String>) -> AuthStatus {
        AuthStatus {
            v: 1,
            state: s.state,
            account_id: s.current.as_ref().map(|a| a.account_id.clone()),
            scopes: s
                .current
                .as_ref()
                .map(|a| a.scopes.clone())
                .unwrap_or_default(),
            storage: s.storage,
            access_token_expires_at: s.current.as_ref().map(|a| a.expires_at),
            auth_url,
        }
    }
}
