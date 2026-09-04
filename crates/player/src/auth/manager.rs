use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::warn;

use crate::event;

use super::constants::DEFAULT_SCOPES;
use super::storage;
use super::types::{AuthState, AuthStatus, InnerState, Storage};

pub struct AuthManager {
    pub(super) client_id: RwLock<String>,
    pub(super) scopes: Vec<String>,

    /// Current authoritative state.
    pub(super) state: Mutex<InnerState>,
    /// In-flight single-flight refresh lock.
    pub(super) refresh_lock: Mutex<()>,
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
            events,
            cancel: Mutex::new(None),
            join_handle: Mutex::new(None),
        }
    }

    /// Update the client ID dynamically without restarting the player.
    pub async fn set_client_id(&self, client_id: String) {
        *self.client_id.write().await = client_id;
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
        let mut s = self.state.lock().await;
        s.storage = storage;
        if let Some(at) = current {
            s.current = Some(at);
            s.state = AuthState::Authenticated;
        } else {
            s.state = AuthState::Unauthenticated;
        }
        let snap = self.snapshot_locked(&s, None);
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
