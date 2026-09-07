//! Guards for the Spotify login session lifecycle.
//!
//! Each test below reproduces a user-visible failure and locks in the fixed
//! behavior:
//!
//! - A dead refresh token used to leave the app showing "logged in" while
//!   every request failed, because the player never told the UI the refresh
//!   had failed.
//! - Switching the Spotify Client ID kept the old login, whose token the new
//!   client cannot refresh, so the next request failed.
//! - Logging out kept the background playback credentials on disk, so the
//!   next playback silently resumed the previous user's connection.

use super::manager::AuthManager;
use super::types::{AccessToken, AuthState, Storage};

fn expired_token() -> AccessToken {
    AccessToken {
        access_token: "expired-access".to_string(),
        refresh_token: "invalid-refresh-token".to_string(),
        expires_at: 1,
        account_id: "default".to_string(),
        scopes: vec![],
    }
}

#[tokio::test]
async fn failed_refresh_notifies_the_ui() {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(16);
    let auth = AuthManager::new("regression-client".to_string(), tx);
    {
        let mut s = auth.state.lock().await;
        s.current = Some(expired_token());
        s.state = AuthState::Authenticated;
        s.storage = Storage::Memory;
    }

    let res = auth.get_web_token().await;
    assert!(res.is_err(), "refresh with a bogus token must fail");
    assert_eq!(
        auth.status().await.state,
        AuthState::RefreshFailed,
        "backend state must flip to refresh-failed"
    );

    // The UI only learns through events, so the failure must arrive as an
    // `auth.changed` event the login screen can react to.
    let mut saw_changed = false;
    let deadline = tokio::time::sleep(std::time::Duration::from_millis(500));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            line = rx.recv() => {
                let Some(line) = line else { break };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                if v.get("event").and_then(|e| e.as_str()) == Some("auth.changed")
                    && v.get("data").and_then(|d| d.get("state")).and_then(|s| s.as_str()) == Some("refresh-failed")
                {
                    saw_changed = true;
                    break;
                }
            }
        }
    }
    assert!(
        saw_changed,
        "expected auth.changed with state refresh-failed after refresh failure"
    );
}

#[tokio::test]
async fn switching_client_id_drops_the_old_login() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
    let auth = AuthManager::new("old-client-id".to_string(), tx);
    {
        let mut s = auth.state.lock().await;
        s.current = Some(AccessToken {
            expires_at: 9_999_999_999_999,
            ..expired_token()
        });
        s.state = AuthState::Authenticated;
        s.storage = Storage::Memory;
    }

    auth.set_client_id("new-client-id".to_string()).await;
    let st = auth.status().await;
    assert!(
        st.state != AuthState::Authenticated || st.account_id.is_none(),
        "stale session survived a client_id change (refresh would fail with invalid_grant)"
    );
}

#[tokio::test]
async fn logout_deletes_the_playback_credentials_cache() {
    let tmp = std::env::temp_dir().join(format!(
        "spotoei-regression-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let cache_dir = tmp.join("cache");
    let config_dir = tmp.join("config");
    std::fs::create_dir_all(cache_dir.join("spotoei")).expect("create cache dir");
    std::fs::create_dir_all(config_dir.join("spotoei")).expect("create config dir");
    let cred_file = cache_dir.join("spotoei").join("credentials.json");
    std::fs::write(&cred_file, r#"{"dummy":true}"#).expect("write fake credentials");

    let old_cache = std::env::var("XDG_CACHE_HOME").ok();
    let old_config = std::env::var("XDG_CONFIG_HOME").ok();
    std::env::set_var("XDG_CACHE_HOME", &cache_dir);
    std::env::set_var("XDG_CONFIG_HOME", &config_dir);

    let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
    let auth = AuthManager::new("regression-client".to_string(), tx);
    let _ = auth.logout().await;
    let survived = cred_file.exists();

    match old_cache {
        Some(v) => std::env::set_var("XDG_CACHE_HOME", v),
        None => std::env::remove_var("XDG_CACHE_HOME"),
    }
    match old_config {
        Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
        None => std::env::remove_var("XDG_CONFIG_HOME"),
    }
    let _ = std::fs::remove_dir_all(&tmp);

    assert!(
        !survived,
        "librespot credentials.json survived logout; next session would resume the old user"
    );
}
