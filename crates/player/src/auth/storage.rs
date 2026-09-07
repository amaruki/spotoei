use tracing::warn;

use super::constants::KEYRING_SERVICE;
use super::types::{AccessToken, AuthError};

fn memory_only() -> bool {
    std::env::var("SPOTOEI_AUTH_STORAGE").as_deref() == Ok("memory")
        || std::env::var("SPOTOEI_MOCK_AUTH").is_ok()
}

pub fn keyring_entry(account_id: &str) -> Result<keyring::Entry, AuthError> {
    let user = format!("web-api-refresh:{account_id}");
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

pub fn session_file_path() -> std::path::PathBuf {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let spotoei_dir = config_dir.join("spotoei");
    let _ = std::fs::create_dir_all(&spotoei_dir);
    spotoei_dir.join("session.json")
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

pub async fn load_session() -> Result<Option<AccessToken>, AuthError> {
    if memory_only() {
        return Err(AuthError::KeyringUnavailable("memory-only authentication".into()));
    }
    match load_from_keyring("default").await {
        Ok(Some(at)) => {
            // Remove stale dev file if keyring now works
            if cfg!(debug_assertions) {
                let _ = std::fs::remove_file(session_file_path());
            }
            Ok(Some(at))
        }
        Ok(None) => {
            if cfg!(debug_assertions) {
                if let Some(at) = try_load_dev_file() {
                    return Ok(Some(at));
                }
            }
            Ok(None)
        }
        Err(e) => {
            if cfg!(debug_assertions) {
                if let Some(at) = try_load_dev_file() {
                    warn!("keyring unavailable, using dev file fallback");
                    return Ok(Some(at));
                }
            }
            Err(e)
        }
    }
}

#[cfg(debug_assertions)]
fn try_load_dev_file() -> Option<AccessToken> {
    let path = session_file_path();
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<AccessToken>(&content).ok()
}

#[cfg(not(debug_assertions))]
fn try_load_dev_file() -> Option<AccessToken> {
    None
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
    let merged_token;
    let token_ref = if at.refresh_token.trim().is_empty() {
        if let Ok(Some(prev)) = load_session().await {
            if !prev.refresh_token.trim().is_empty() {
                let mut t = at.clone();
                t.refresh_token = prev.refresh_token;
                merged_token = t;
                &merged_token
            } else {
                at
            }
        } else {
            at
        }
    } else {
        at
    };
    let account_ok = save_to_keyring_account(&token_ref.account_id, token_ref).await.is_ok();
    let default_ok = save_to_keyring_account("default", token_ref).await.is_ok();
    if account_ok || default_ok {
        let path = session_file_path();
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    if cfg!(debug_assertions) && try_save_dev_file(token_ref).is_ok() {
        warn!("keyring unavailable, persisted dev fallback to session.json");
        return Ok(());
    }
    // No durable store available — keep credentials in memory only and
    // let the caller surface Storage::Memory to the UI. Never write
    // refresh_token to session.json in release.
    Err(AuthError::KeyringUnavailable(
        "keyring unavailable for all accounts; credentials will be in-memory only".into(),
    ))
}

#[cfg(debug_assertions)]
fn try_save_dev_file(at: &AccessToken) -> Result<(), AuthError> {
    let path = session_file_path();
    let s = serde_json::to_string_pretty(at).map_err(|e| AuthError::Config(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true).mode(0o600);
        let mut file = options
            .open(&path)
            .map_err(|e| AuthError::Config(format!("open {}: {e}", path.display())))?;
        file.write_all(s.as_bytes())
            .map_err(|e| AuthError::Config(format!("write {}: {e}", path.display())))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, s.as_bytes())
            .map_err(|e| AuthError::Config(format!("write {}: {e}", path.display())))?;
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
fn try_save_dev_file(_at: &AccessToken) -> Result<(), AuthError> {
    Err(AuthError::KeyringUnavailable("dev fallback disabled in release".into()))
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
    let path = session_file_path();
    let _ = std::fs::remove_file(path);
    Ok(())
}
