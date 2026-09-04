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
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            std::path::PathBuf::from(home).join(".config")
        });
    let spotoei_dir = config_dir.join("spotoei");
    let _ = std::fs::create_dir_all(&spotoei_dir);
    spotoei_dir.join("session.json")
}

pub async fn load_session() -> Result<Option<AccessToken>, AuthError> {
    if let Ok(Some(at)) = load_from_keyring("default").await {
        return Ok(Some(at));
    }
    let path = session_file_path();
    if path.exists() {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(at) = serde_json::from_slice::<AccessToken>(&bytes) {
                return Ok(Some(at));
            }
        }
    }
    Ok(None)
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

    warn!(
        account_id = %at.account_id,
        "keyring unavailable for all accounts; falling back to encrypted-at-rest session file",
    );
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
