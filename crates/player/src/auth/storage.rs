use tracing::warn;

use super::constants::KEYRING_SERVICE;
use super::types::{AccessToken, AuthError};

fn memory_only() -> bool {
    std::env::var("SPOTOEI_AUTH_STORAGE").as_deref() == Ok("memory")
        || std::env::var("SPOTOEI_MOCK_AUTH").is_ok()
}

/// Remove credential files written by SPOTOEI versions that predate the
/// keyring-only policy. These files contain OAuth tokens and must not remain
/// after an upgrade.
pub fn purge_legacy_file_credentials() {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|home| std::path::PathBuf::from(home).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        })
        .join("spotoei");
    for filename in ["session.json", "streaming.json"] {
        let _ = std::fs::remove_file(config_dir.join(filename));
    }
}

pub fn keyring_entry(account_id: &str) -> Result<keyring::Entry, AuthError> {
    let user = format!("web-api-refresh:{account_id}");
    keyring::Entry::new(KEYRING_SERVICE, &user)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
}

pub fn streaming_keyring_entry(account_id: &str) -> Result<keyring::Entry, AuthError> {
    let user = format!("streaming-refresh:{account_id}");
    keyring::Entry::new(KEYRING_SERVICE, &user)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
}

pub async fn load_from_keyring(account_id: &str) -> Result<Option<AccessToken>, AuthError> {
    let entry = keyring_entry(account_id)?;
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

pub async fn load_streaming_session_for(account_id: &str) -> Result<Option<AccessToken>, AuthError> {
    if memory_only() {
        return Ok(None);
    }
    let entry = streaming_keyring_entry(account_id)?;
    match entry.get_password() {
        Ok(s) => serde_json::from_str::<AccessToken>(&s)
            .map(Some)
            .map_err(|e| AuthError::KeyringUnavailable(format!("invalid streaming credential: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AuthError::KeyringUnavailable(e.to_string())),
    }
}

pub async fn save_streaming_session(at: &AccessToken) -> Result<(), AuthError> {
    if memory_only() {
        return Err(AuthError::KeyringUnavailable("memory-only authentication".into()));
    }
    let s = serde_json::to_string(at).map_err(|e| AuthError::Config(e.to_string()))?;
    let entry = streaming_keyring_entry(&at.account_id)?;
    entry
        .set_password(&s)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))?;
    let default = streaming_keyring_entry("default")?;
    default
        .set_password(&s)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
}

pub async fn delete_streaming_session(account_id: Option<&str>) {
    if let Some(account_id) = account_id {
        if let Ok(entry) = streaming_keyring_entry(account_id) {
            let _ = entry.delete_credential();
        }
    }
    if let Ok(entry) = streaming_keyring_entry("default") {
        let _ = entry.delete_credential();
    }
}

/// Location of the librespot playback credentials cache. Mirrors the cache
/// directory resolution in the playback session setup, so logout can remove
/// exactly the file a new session would otherwise resume.
pub fn librespot_credentials_path() -> std::path::PathBuf {
    let cache_dir = std::env::var("XDG_CACHE_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".cache"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        })
        .join("spotoei");
    cache_dir.join("credentials.json")
}

/// Best-effort removal of the librespot credentials cache. Called on logout,
/// client ID reset, and fresh login so the next playback session cannot
/// silently resume the previous user's connection.
pub fn delete_librespot_credentials_cache() {
    let _ = std::fs::remove_file(librespot_credentials_path());
}

pub async fn load_session(client_id: &str) -> Result<Option<AccessToken>, AuthError> {
    if memory_only() {
        return Err(AuthError::KeyringUnavailable("memory-only authentication".into()));
    }
    let Some(at) = load_from_keyring("default").await? else {
        return Ok(None);
    };
    if credential_matches_client(&at, client_id) {
        Ok(Some(at))
    } else {
        Ok(None)
    }
}

pub(super) fn credential_matches_client(token: &AccessToken, client_id: &str) -> bool {
    !token.client_id.is_empty() && token.client_id == client_id
}
pub async fn save_to_keyring_account(account_id: &str, at: &AccessToken) -> Result<(), AuthError> {
    let entry = keyring_entry(account_id)?;
    let s = serde_json::to_string(at).map_err(|e| AuthError::Config(e.to_string()))?;
    entry
        .set_password(&s)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
}

pub async fn save_session(at: &AccessToken) -> Result<(), AuthError> {
    if memory_only() {
        return Err(AuthError::KeyringUnavailable("memory-only authentication".into()));
    }
    save_to_keyring_account(&at.account_id, at).await?;
    save_to_keyring_account("default", at).await
}

pub async fn delete_from_keyring(account_id: &str) -> Result<(), AuthError> {
    let entry = keyring_entry(account_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AuthError::KeyringUnavailable(e.to_string())),
    }
}

pub async fn delete_session(account_id: &str) -> Result<(), AuthError> {
    if memory_only() {
        return Ok(());
    }
    let _ = delete_from_keyring(account_id).await;
    let _ = delete_from_keyring("default").await;
    Ok(())
}
