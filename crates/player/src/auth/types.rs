use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing Spotify client_id")]
    MissingClientId,
    #[error("not authenticated")]
    NotAuthenticated,
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

/// PKCE transaction state held only in memory for the duration of a flow.
#[derive(Clone)]
pub struct PkceTx {
    pub verifier: String,
    pub state: String,
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
}

pub struct InnerState {
    pub state: AuthState,
    pub storage: Storage,
    pub current: Option<AccessToken>,
    pub pkce: Option<PkceTx>,
    pub last_auth_url: Option<String>,
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
