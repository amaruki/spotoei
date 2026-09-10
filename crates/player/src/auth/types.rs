use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing Spotify client_id")]
    MissingClientId,
    #[error("not authenticated")]
    NotAuthenticated,
    #[error("streaming login required — complete Step 2/2 in the app")]
    StreamingLoginRequired,
    #[error("OAuth error: {0}")]
    OAuth(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("keyring unavailable: {0}")]
    KeyringUnavailable(String),
    #[error("config error: {0}")]
    Config(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
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
    #[serde(default)]
    pub scopes: Vec<String>,
    pub storage: Storage,
    pub access_token_expires_at: Option<u64>,
    pub auth_url: Option<String>,
}

/// Which of the two independent logins a PKCE transaction belongs to.
/// The Web login authorizes API access under the configured client; the
/// streaming login authorizes audio under the official Keymaster client.
/// They must never be confused: completing one as the other either drops
/// the login or stores a token the other side cannot use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFlow {
    Web,
    Streaming,
}

/// PKCE transaction state held only in memory for the duration of a flow.
#[derive(Clone)]
pub struct PkceTx {
    pub verifier: String,
    pub state: String,
    pub flow: AuthFlow,
}

/// In-memory access-token cache. Refresh material lives in keyring (or here
/// when keyring is unavailable); access tokens never persist to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    pub account_id: String,
    pub scopes: Vec<String>,
    /// Spotify client ID that issued this credential. A refresh token is
    /// client-bound and must never be reused after the configured client
    /// changes.
    #[serde(default)]
    pub client_id: String,
}

pub struct InnerState {
    pub state: AuthState,
    pub storage: Storage,
    pub current: Option<AccessToken>,
    /// Streaming credentials remain in memory for this process even when
    /// the system keyring is unavailable.
    pub streaming: Option<AccessToken>,
    pub pkce: Option<PkceTx>,
    pub last_auth_url: Option<String>,
}

impl InnerState {
    pub fn find_pkce(&self, state: &str) -> Option<PkceTx> {
        self.pkce
            .as_ref()
            .filter(|transaction| transaction.state == state)
            .cloned()
    }

    pub fn remove_pkce(&mut self, state: &str) -> Option<PkceTx> {
        if self.pkce.as_ref().map(|p| p.state.as_str()) == Some(state) {
            self.pkce.take()
        } else {
            None
        }
    }

    pub fn clear_all_pkce(&mut self) {
        self.pkce = None;
    }
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[allow(dead_code)]
    pub token_type: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

pub struct RefreshedToken {
    pub access_token: String,
    pub expires_at: u64,
    pub refresh_token: String,
}
