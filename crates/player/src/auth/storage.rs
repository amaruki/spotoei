use tracing::warn;

use super::constants::KEYRING_SERVICE;
use super::types::{AccessToken, AuthError};

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

pub async fn load_session() -> Result<Option<AccessToken>, AuthError> {
    // Keyring is the only durable store for refresh tokens. The legacy
    // plaintext session.json fallback was removed for privacy (FSD 9.4,
    // TSD02 5.1). If it exists on disk from an old build, remove it
    // opportunistically but never read secrets from it.
    let path = session_file_path();
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    match load_from_keyring("default").await {
        Ok(v) => Ok(v),
        Err(e) => Err(e),
    }
}

pub async fn save_to_keyring_account(account_id: &str, at: &AccessToken) -> Result<(), AuthError> {
    let entry = keyring_entry(account_id)?;
    let s = serde_json::to_string(at).map_err(|e| AuthError::Config(e.to_string()))?;
    entry
        .set_password(&s)
        .map_err(|e| AuthError::KeyringUnavailable(e.to_string()))
}

pub async fn save_session(at: &AccessToken) -> Result<(), AuthError> {
    let account_ok = save_to_keyring_account(&at.account_id, at).await.is_ok();
    let default_ok = save_to_keyring_account("default", at).await.is_ok();
    if account_ok || default_ok {
        let path = session_file_path();
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    // No durable store available — keep credentials in memory only and
    // let the caller surface Storage::Memory to the UI. Never write
    // refresh_token to session.json.
    Err(AuthError::KeyringUnavailable(
        "keyring unavailable for all accounts; credentials will be in-memory only".into(),
    ))
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
    let _ = delete_from_keyring(account_id).await;
    let _ = delete_from_keyring("default").await;
    let path = session_file_path();
    let _ = std::fs::remove_file(path);
    Ok(())
}
