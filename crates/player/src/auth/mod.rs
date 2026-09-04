//! Authentication subsystem.
//!
//! Implements OAuth Authorization Code + PKCE for Spotify, with secrets
//! persisted through the OS keyring when available and a strict in-memory
//! fallback when not. No Client Secret is ever requested or stored.
//!
//! Secret material (verifier, code, access token, refresh token) MUST NOT
//! appear in stderr logs or in any response sent over the IPC envelope.
//! The `auth.*` data shapes only carry opaque metadata.
mod callback_server;
mod constants;
mod manager;
mod oauth_flow;
mod storage;
mod token;
mod types;

pub use constants::{
    html_error, html_escape, DEFAULT_SCOPES, HTML_SUCCESS, KEYMASTER_CLIENT_ID, KEYMASTER_PATH,
    KEYMASTER_PORT, KEYRING_SERVICE, REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
pub use manager::AuthManager;
pub use types::{AuthError, AuthState, AuthStatus, Storage};
