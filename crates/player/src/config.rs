use serde_json::Value;

use crate::auth;

pub fn load_client_id_from_config() -> String {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let config_path = config_dir.join("spotoei").join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&content) {
            if let Some(id) = val
                .get("spotify")
                .and_then(|s| s.get("clientId"))
                .and_then(|c| c.as_str())
            {
                if !id.trim().is_empty() {
                    return id.trim().to_string();
                }
            }
        }
    }
    String::new()
}

pub fn resolve_client_id() -> String {
    if let Ok(v) = std::env::var("SPOTOEI_CLIENT_ID") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    let from_config = load_client_id_from_config();
    if !from_config.is_empty() {
        return from_config;
    }
    // No shared default. BYO Client ID is required. The former
    // KEYMASTER fallback is only available in debug builds when
    // explicitly opted in via SPOTOEI_ALLOW_KEYMASTER=1.
    if cfg!(debug_assertions) {
        if std::env::var("SPOTOEI_ALLOW_KEYMASTER").as_deref() == Ok("1") {
            return auth::KEYMASTER_CLIENT_ID.to_string();
        }
    }
    String::new()
}
