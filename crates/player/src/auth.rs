//! Authentication subsystem.
//!
//! Implements OAuth Authorization Code + PKCE for Spotify, with secrets
//! persisted through the OS keyring when available and a strict in-memory
//! fallback when not. No Client Secret is ever requested or stored.
//!
//! Secret material (verifier, code, access token, refresh token) MUST NOT
//! appear in stderr logs or in any response sent over the IPC envelope.
//! The `auth.*` data shapes only carry opaque metadata.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::event;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::warn;
const KEYRING_SERVICE: &str = "spotoei";
const SPOTIFY_ACCOUNTS: &str = "https://accounts.spotify.com";
const REDIRECT_PATH: &str = "/callback";
const DEFAULT_SCOPES: &[&str] = &["playlist-read-private", "user-library-read"];

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("keyring unavailable: {0}")]
    KeyringUnavailable(String),
    #[error("missing client id (set SPOTOEI_CLIENT_ID)")]
    MissingClientId,
    #[error("oauth error: {0}")]
    OAuth(String),
    #[error("http error: {0}")]
    Http(String),
    #[error("no active authentication")]
    NotAuthenticated,
    #[allow(dead_code)]
    #[error("config: {0}")]
    Config(String),
    #[allow(dead_code)]
    #[error("not yet implemented: {0}")]
    NotImplemented(&'static str),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthState {
    Unauthenticated,
    Authenticating,
    Authenticated,
    RefreshFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Storage {
    Keyring,
    Memory,
    Unavailable,
}

/// Information about the current authentication session, safe to expose.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub v: u32,
    pub state: AuthState,
    pub account_id: Option<String>,
    pub scopes: Vec<String>,
    pub storage: Storage,
    pub access_token_expires_at: Option<u64>,
    pub auth_url: Option<String>,
}

/// PKCE transaction state held only in memory for the duration of a flow.
#[derive(Clone)]
struct PkceTx {
    verifier: String,
    state: String,
}

/// In-memory access-token cache. Refresh material lives in keyring (or here
/// when keyring is unavailable); access tokens never persist to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccessToken {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    account_id: String,
    scopes: Vec<String>,
}

pub struct AuthManager {
    client_id: String,
    scopes: Vec<String>,

    /// Current authoritative state.
    state: Mutex<InnerState>,
    /// In-flight single-flight refresh lock.
    refresh_lock: Mutex<()>,
    /// Monotonic event sequence shared across subsystems.
    seq: AtomicU64,
    /// Sink for outgoing protocol events.
    events: mpsc::Sender<String>,
    /// Cancellation for the in-flight loopback callback server, if any.
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

struct InnerState {
    state: AuthState,
    storage: Storage,
    current: Option<AccessToken>,
    pkce: Option<PkceTx>,
    last_auth_url: Option<String>,
}

impl AuthManager {
    /// Build a new auth manager. `client_id` MUST be supplied via config.
    /// `events` receives protocol-formatted `auth.*` event lines.
    pub fn new(client_id: String, events: mpsc::Sender<String>) -> Self {
        Self {
            client_id,
            scopes: DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect(),
            state: Mutex::new(InnerState {
                state: AuthState::Unauthenticated,
                storage: Storage::Unavailable,
                current: None,
                pkce: None,
                last_auth_url: None,
            }),
            refresh_lock: Mutex::new(()),
            seq: AtomicU64::new(0),
            events,
            cancel: Mutex::new(None),
        }
    }

    /// Reserve and return the next monotonic event sequence number.
    pub fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed).wrapping_add(1)
    }

    async fn emit(&self, name: &str, data: Value) {
        let seq = self.next_seq();
        let line = event(name, seq, data);
        let _ = self.events.send(line).await;
    }

    /// Cancel any in-flight loopback callback server.
    pub async fn cancel_in_flight(&self) {
        if let Some(tx) = self.cancel.lock().await.take() {
            let _ = tx.send(());
        }
    }
    /// Determine storage tier and load any persisted refresh material.
    /// Returns the active status snapshot after hydration.
    pub async fn hydrate(&self) -> AuthStatus {
        // Try to load from keyring under a known fixed account marker.
        // A real account id is only known after a successful login, so on
        // hydrate we probe for a "last-known" account id from a sidecar
        // pointer file in the user data dir. For M1 the pointer file is
        // omitted — auth will read as Unauthenticated and the TUI will
        // prompt the user to log in. This is consistent with the gate
        // criterion "remain authenticated when keyring is available".
        let (storage, current) = match self.load_from_keyring("default").await {
            Ok(Some(at)) => (Storage::Keyring, Some(at)),
            Ok(None) => (Storage::Keyring, None),
            Err(e) => {
                warn!(error = %e, "keyring unavailable; auth will be in-memory only");
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

    pub async fn begin(
        self: &Arc<Self>,
        scopes: Option<Vec<String>>,
    ) -> Result<AuthStatus, AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.begin_mock().await;
        }
        if self.client_id.is_empty() {
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

        // Bind a loopback port for the callback.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AuthError::Http(format!("bind: {e}")))?;
        let bound_port = listener
            .local_addr()
            .map_err(|e| AuthError::Http(format!("local_addr: {e}")))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{bound_port}{REDIRECT_PATH}");

        let scope_str = scopes.unwrap_or_else(|| self.scopes.clone()).join(" ");
        let url = format!(
            "{SPOTIFY_ACCOUNTS}/authorize?client_id={cid}&response_type=code&redirect_uri={ru}&code_challenge_method=S256&code_challenge={cc}&state={st}&scope={sc}",
            cid = urlencoding::encode(&self.client_id),
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

        // Spawn a server task that waits for the callback and validates state.
        let this = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(e) = this.serve_callback(listener, bound_port, cancel_rx).await {
                warn!(error = %e, "auth callback server failed");
            }
        });

        Ok(snap)
    }

    /// Mock auth flow for tests: synthesizes a valid session without a browser.
    async fn begin_mock(self: &Arc<Self>) -> Result<AuthStatus, AuthError> {
        // Read a refresh token from SPOTOEI_MOCK_REFRESH_TOKEN if present.
        // Otherwise emit a fake access token and refresh token so the rest of
        // the system can be exercised end-to-end.
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
        // Persist to keyring when available.
        let snap = match self.save_to_keyring(&at).await {
            Ok(()) => {
                let mut s = self.state.lock().await;
                s.storage = Storage::Keyring;
                s.current = Some(at);
                s.state = AuthState::Authenticated;
                self.snapshot_locked(&s, None)
            }
            Err(e) => {
                warn!(error = %e, "mock auth: keyring save failed; staying in-memory");
                let mut s = self.state.lock().await;
                s.storage = Storage::Memory;
                s.current = Some(at);
                s.state = AuthState::Authenticated;
                self.snapshot_locked(&s, None)
            }
        };
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.completed", value).await;
        }
        Ok(snap)
    }
    /// Logout: erase from keyring (when present) and clear memory.
    pub async fn logout(&self) -> Result<AuthStatus, AuthError> {
        let mut s = self.state.lock().await;
        if let Some(at) = s.current.as_ref() {
            if matches!(s.storage, Storage::Keyring) {
                if let Err(e) = self.delete_from_keyring(&at.account_id).await {
                    warn!(error = %e, "keyring delete failed");
                }
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
    /// Return a usable access token, refreshing when expired. The token value
    /// is returned only to the in-process call; it is never written to logs.
    pub async fn get_web_token(&self) -> Result<(String, u64), AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.get_web_token_mock().await;
        }
        // Single-flight: concurrent callers all serialize on this lock.
        // Inside the lock, re-check the expiry so we don't redundantly
        // refresh when a peer just refreshed.
        let _guard = self.refresh_lock.lock().await;
        let at = {
            let s = self.state.lock().await;
            let at = s.current.clone().ok_or(AuthError::NotAuthenticated)?;
            if at.expires_at > now_ms() + 30_000 {
                return Ok((at.access_token, at.expires_at));
            }
            at
        };
        // Refresh.
        let refreshed = match self.refresh(&at.refresh_token).await {
            Ok(r) => r,
            Err(e) => {
                let mut s = self.state.lock().await;
                s.state = AuthState::RefreshFailed;
                return Err(e);
            }
        };
        let mut new_at = at.clone();
        new_at.access_token = refreshed.access_token.clone();
        new_at.expires_at = refreshed.expires_at;
        new_at.refresh_token = refreshed.refresh_token.clone();
        let token_for_return = new_at.access_token.clone();
        let expires_at = new_at.expires_at;
        let mut s = self.state.lock().await;
        s.current = Some(new_at.clone());
        if matches!(s.storage, Storage::Keyring) {
            if let Err(e) = self.save_to_keyring(&new_at).await {
                warn!(error = %e, "keyring save on refresh failed");
            }
        }
        Ok((token_for_return, expires_at))
    }

    async fn get_web_token_mock(&self) -> Result<(String, u64), AuthError> {
        let s = self.state.lock().await;
        let at = s.current.as_ref().ok_or(AuthError::NotAuthenticated)?;
        Ok((at.access_token.clone(), at.expires_at))
    }

    pub async fn status(&self) -> AuthStatus {
        let s = self.state.lock().await;
        self.snapshot_locked(&s, s.last_auth_url.clone())
    }

    fn snapshot_locked(&self, s: &InnerState, auth_url: Option<String>) -> AuthStatus {
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

    // ---------- loopback callback server ----------

    async fn serve_callback(
        self: Arc<Self>,
        listener: tokio::net::TcpListener,
        port: u16,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<(), AuthError> {
        use http_body_util::Empty;
        use hyper::body::Bytes;
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use hyper::Response;
        use std::convert::Infallible;

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<String, AuthError>>(1);
        let result = loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    // Flow was superseded or explicitly cancelled.
                    return Ok(());
                }
                msg = rx.recv() => break msg,
                accept = listener.accept() => {
                    let (stream, _addr) = match accept {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    let tx = tx.clone();
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let expected_state = {
                        let s = self.state.lock().await;
                        s.pkce.as_ref().map(|p| p.state.clone())
                    };
                    let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let tx = tx.clone();
                        let expected_state = expected_state.clone();
                        async move {
                            if req.uri().path() != REDIRECT_PATH {
                                let body = Empty::<Bytes>::new();
                                let resp = Response::builder().status(404).body(body).unwrap();
                                return Ok::<_, Infallible>(resp);
                            }
                            let q = req.uri().query().unwrap_or("").to_string();
                            let params: std::collections::HashMap<String, String> = url_decode(&q);
                            if let Some(err) = params.get("error") {
                                let _ = tx.send(Err(AuthError::OAuth(err.clone()))).await;
                                let body = Empty::<Bytes>::new();
                                let resp = Response::builder().status(400).body(body).unwrap();
                                return Ok::<_, Infallible>(resp);
                            }
                            let code = params.get("code").cloned().unwrap_or_default();
                            let state = params.get("state").cloned().unwrap_or_default();
                            if Some(&state) != expected_state.as_ref() {
                                let _ = tx
                                    .send(Err(AuthError::OAuth("state mismatch".into())))
                                    .await;
                                let body = Empty::<Bytes>::new();
                                let resp = Response::builder().status(400).body(body).unwrap();
                                return Ok::<_, Infallible>(resp);
                            }
                            let _ = tx.send(Ok(format!("{code}|{state}"))).await;
                            let body = Empty::<Bytes>::new();
                            let resp = Response::builder().status(200).body(body).unwrap();
                            Ok::<_, Infallible>(resp)
                        }
                    });
                    tokio::spawn(async move {
                        let _ = http1::Builder::new().serve_connection(io, svc).await;
                    });
                }
            }
        };
        match result {
            Some(Ok(payload)) => {
                let mut parts = payload.splitn(2, '|');
                let code = parts.next().unwrap_or_default().to_string();
                let state = parts.next().unwrap_or_default().to_string();
                if let Err(e) = self.complete_flow(&code, &state, port).await {
                    warn!(error = %e, "auth complete flow failed");
                    self.emit("auth.failed", json!({ "error": e.to_string() }))
                        .await;
                }
            }
            Some(Err(e)) => {
                warn!(error = %e, "auth callback received error");
                let mut s = self.state.lock().await;
                s.state = AuthState::Unauthenticated;
                drop(s);
                self.emit("auth.failed", json!({ "error": e.to_string() }))
                    .await;
            }
            None => {}
        }
        Ok(())
    }

    async fn complete_flow(&self, code: &str, state: &str, port: u16) -> Result<(), AuthError> {
        let pkce = {
            let s = self.state.lock().await;
            s.pkce.clone()
        };
        let pkce = pkce.ok_or_else(|| AuthError::OAuth("no in-flight PKCE tx".into()))?;
        if pkce.state != state {
            return Err(AuthError::OAuth("state mismatch".into()));
        }
        let (at, account_id) = self
            .exchange_code(code, &pkce.verifier, "127.0.0.1", port)
            .await?;
        let mut s = self.state.lock().await;
        s.current = Some(at.clone());
        s.state = AuthState::Authenticated;
        s.pkce = None;
        s.last_auth_url = None;
        if matches!(s.storage, Storage::Keyring) {
            if let Err(e) = self.save_to_keyring(&at).await {
                warn!(error = %e, "keyring save on complete failed");
            }
        }
        let snap = self.snapshot_locked(&s, None);
        drop(s);
        if let Ok(value) = serde_json::to_value(&snap) {
            self.emit("auth.completed", value).await;
        }
        let _ = account_id;
        Ok(())
    }

    // ---------- token exchange (real, non-mock) ----------

    async fn exchange_code(
        &self,
        code: &str,
        verifier: &str,
        _host: &str,
        port: u16,
    ) -> Result<(AccessToken, String), AuthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AuthError::Http(e.to_string()))?;
        let redirect_uri = format!("http://127.0.0.1:{port}{REDIRECT_PATH}");
        let body = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &self.client_id),
            ("code_verifier", verifier),
        ];
        let resp = client
            .post(format!("{SPOTIFY_ACCOUNTS}/api/token"))
            .form(&body)
            .send()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(AuthError::Http(format!("status {}", resp.status())));
        }
        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        // The token endpoint does not return account_id; derive from /me
        // would require an extra call. For M1 we label the account "default"
        // and rely on a future milestone to enrich profile metadata.
        let account_id = "default".to_string();
        let at = AccessToken {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token.unwrap_or_default(),
            expires_at: now_ms() + parsed.expires_in * 1000,
            account_id: account_id.clone(),
            scopes: parsed
                .scope
                .map(|s| s.split(' ').map(String::from).collect())
                .unwrap_or_default(),
        };
        Ok((at, account_id))
    }

    async fn refresh(&self, refresh_token: &str) -> Result<RefreshedToken, AuthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AuthError::Http(e.to_string()))?;
        let body = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &self.client_id),
        ];
        let resp = client
            .post(format!("{SPOTIFY_ACCOUNTS}/api/token"))
            .form(&body)
            .send()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(AuthError::Http(format!("refresh status {}", resp.status())));
        }
        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        Ok(RefreshedToken {
            access_token: parsed.access_token,
            expires_at: now_ms() + parsed.expires_in * 1000,
            refresh_token: parsed
                .refresh_token
                .unwrap_or_else(|| refresh_token.to_string()),
        })
    }

    // ---------- keyring ----------

    fn keyring_entry(&self, account_id: &str) -> Result<keyring::Entry, AuthError> {
        let user = format!("web-api-refresh:{account_id}");
        keyring::Entry::new(KEYRING_SERVICE, &user)
            .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
    }

    async fn load_from_keyring(&self, account_id: &str) -> Result<Option<AccessToken>, AuthError> {
        let entry = self.keyring_entry(account_id)?;
        match entry.get_password() {
            Ok(s) => match serde_json::from_str::<AccessToken>(&s) {
                Ok(at) => Ok(Some(at)),
                Err(e) => {
                    warn!(error = %e, "keyring payload corrupt; ignoring");
                    Ok(None)
                }
            },
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::KeyringUnavailable(e.to_string())),
        }
    }

    async fn save_to_keyring(&self, at: &AccessToken) -> Result<(), AuthError> {
        let entry = self.keyring_entry(&at.account_id)?;
        let s = serde_json::to_string(at).map_err(|e| AuthError::Config(e.to_string()))?;
        entry
            .set_password(&s)
            .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
    }

    async fn delete_from_keyring(&self, account_id: &str) -> Result<(), AuthError> {
        let entry = self.keyring_entry(account_id)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AuthError::KeyringUnavailable(e.to_string())),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[allow(dead_code)]
    token_type: String,
    expires_in: u64,
    refresh_token: Option<String>,
    scope: Option<String>,
}

struct RefreshedToken {
    access_token: String,
    expires_at: u64,
    refresh_token: String,
}

// ---------- PKCE helpers ----------

fn generate_verifier() -> String {
    // RFC 7636 requires 43-128 chars of unreserved base64url; we use 64 bytes
    // (86 base64url chars) for entropy.
    let mut buf = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn s256_challenge(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

fn generate_state() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn url_decode(q: &str) -> std::collections::HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| {
            let mut it = kv.splitn(2, '=');
            let k = it.next()?.to_string();
            let v = it.next().unwrap_or("").to_string();
            Some((
                urlencoding::decode(&k).ok()?.into_owned(),
                urlencoding::decode(&v).ok()?.into_owned(),
            ))
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
