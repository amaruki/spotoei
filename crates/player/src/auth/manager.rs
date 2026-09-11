use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::warn;

use crate::event;

use super::constants::{now_ms, DEFAULT_SCOPES};
use super::storage;
use super::types::{AuthState, AuthStatus, InnerState, PkceTx, Storage};

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
    /// Auth-flow generation. Bumped whenever a sign-out or a new login
    /// supersedes the in-flight OAuth transaction. A callback that finishes
    /// its token exchange after this bump must throw the credentials away
    /// instead of resurrecting the identity the user just replaced.
    flow_epoch: AtomicU64,
    /// Forces the next streaming-token read to skip its cache and refresh.
    /// The streaming tier lives in the keyring (no in-memory copy to expire),
    /// so invalidation is a flag consumed once by `get_streaming_token`.
    pub(super) streaming_force_refresh: AtomicBool,
    /// Sink for outgoing protocol events.
    pub(super) events: mpsc::Sender<String>,
    /// Cancellation for the in-flight loopback callback server, if any.
    pub(super) cancel: Mutex<Option<oneshot::Sender<()>>>,
    /// `JoinHandle` for the in-flight loopback callback server, if any.
    /// Held so the sidecar main loop can abort + await it on shutdown.
    pub(super) join_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// The TCP port the active callback server is listening on, if any.
    pub(super) bound_port: Mutex<Option<u16>>,
    /// PKCE state owned by the active listener, if any. Used to close the
    /// listener when its flow completes without racing a newer flow.
    pub(super) listener_state: Mutex<Option<String>>,
    /// How many times a stale callback was auto-forwarded to the active
    /// login, keyed by the stale state. Caps redirect loops.
    redirect_counts: Mutex<HashMap<String, (u32, u64)>>,
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
                streaming: None,
                pkce: None,
                last_auth_url: None,
                recent_states: Vec::new(),
            }),
            refresh_lock: Mutex::new(()),
            session_epoch: AtomicU64::new(0),
            flow_epoch: AtomicU64::new(0),
            streaming_force_refresh: AtomicBool::new(false),
            events,
            cancel: Mutex::new(None),
            join_handle: Mutex::new(None),
            bound_port: Mutex::new(None),
            listener_state: Mutex::new(None),
            redirect_counts: Mutex::new(HashMap::new()),
        }
    }

    /// Count an auto-forward of a stale callback for `state`. Returns how many
    /// times this state has been forwarded. Callers stop redirecting beyond a
    /// small cap so a browser/bounce loop cannot spin forever.
    pub async fn note_callback_redirect(&self, state: &str) -> u32 {
        let now = now_ms();
        let mut counts = self.redirect_counts.lock().await;
        counts.retain(|_, (_, at)| now.saturating_sub(*at) <= 10 * 60 * 1000);
        let count = {
            let entry = counts.entry(state.to_string()).or_insert((0, now));
            entry.0 += 1;
            entry.1 = now;
            entry.0
        };
        if counts.len() > 64 {
            counts.clear();
        }
        count
    }

    /// Atomically claim the in-flight PKCE transaction for `state`. Only one
    /// caller can win; the state is recorded as recently handled so duplicate
    /// tabs get a calm notice. The returned generation was captured before the
    /// claim so a later sign-out/new login invalidates the exchange.
    pub(super) async fn claim_pkce(&self, state: &str) -> Option<(u64, PkceTx)> {
        let mut s = self.state.lock().await;
        let flow = self.flow_epoch();
        s.remove_pkce(state).map(|tx| (flow, tx))
    }

    /// Close the loopback listener when it still owns `state`. Called after a
    /// flow completes so the port is free immediately, without racing a newer
    /// login that already replaced the listener.
    pub(super) async fn close_listener_if_owner(&self, state: &str) {
        let owns = self.listener_state.lock().await.as_deref() == Some(state);
        if owns {
            self.cancel_in_flight().await;
        }
    }

    /// Update the client ID dynamically without restarting the player.
    /// A token minted for one client is rejected under another, so any
    /// existing session is dropped and playback is told to reconnect.
    pub async fn set_client_id(&self, client_id: String) {
        // Serialize with the background streaming refresh: a token minted for
        // the old client must never be persisted after this reset.
        let _refresh_guard = self.refresh_lock.lock().await;
        *self.client_id.write().await = client_id;
        let (snap, account_id) = {
            let mut s = self.state.lock().await;
            let account_id = s.current.as_ref().map(|token| token.account_id.clone());
            s.current = None;
            s.streaming = None;
            s.clear_all_pkce();
            s.last_auth_url = None;
            s.state = AuthState::Unauthenticated;
            self.bump_epoch();
            self.bump_flow_epoch();
            (self.snapshot_locked(&s, None), account_id)
        };
        if let Some(account_id) = account_id.as_deref() {
            let _ = storage::delete_session(account_id).await;
        }
        storage::delete_streaming_session(account_id.as_deref()).await;
        storage::delete_librespot_credentials_cache();
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.changed", value).await;
        }
    }

    /// Playback generation for the current auth identity.
    pub fn session_epoch(&self) -> u64 {
        self.session_epoch.load(Ordering::SeqCst)
    }

    /// Auth-flow generation for superseding in-flight OAuth callbacks.
    pub fn flow_epoch(&self) -> u64 {
        self.flow_epoch.load(Ordering::SeqCst)
    }

    pub(super) fn bump_epoch(&self) {
        self.session_epoch.fetch_add(1, Ordering::SeqCst);
    }

    pub(super) fn bump_flow_epoch(&self) {
        self.flow_epoch.fetch_add(1, Ordering::SeqCst);
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
        // The streaming tier has no in-memory copy; flag it so its next
        // read skips the cached token and refreshes instead.
        self.streaming_force_refresh.store(true, Ordering::SeqCst);
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
        *self.bound_port.lock().await = None;
        *self.listener_state.lock().await = None;
    }
    /// Returns the active status snapshot after hydration.
    pub async fn hydrate(&self) -> AuthStatus {
        storage::purge_legacy_file_credentials();
        let client_id = self.client_id.read().await.clone();
        let (storage, current) = match storage::load_session(&client_id).await {
            Ok(Some(at)) => (Storage::Keyring, Some(at)),
            Ok(None) => (Storage::Keyring, None),
            Err(e) => {
                warn!(error = %e, "storage unavailable; auth will be in-memory only");
                (Storage::Memory, None)
            }
        };
        let streaming = match current.as_ref() {
            Some(token) => storage::load_streaming_session_for(&token.account_id)
                .await
                .ok()
                .flatten(),
            None => None,
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
            s.streaming = streaming;
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
            pending: s.pkce.is_some(),
        }
    }
}
