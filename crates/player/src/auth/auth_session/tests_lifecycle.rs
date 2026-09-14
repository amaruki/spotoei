use std::sync::atomic::Ordering;

use super::super::manager::AuthManager;
use super::super::types::{AccessToken, AuthError, AuthState, Storage};
use super::{expired_token, web_pkce, with_memory_storage, TEST_ENV_LOCK};

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
    let _guard = TEST_ENV_LOCK.lock().await;
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

#[tokio::test]
async fn streaming_token_requires_streaming_login() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = AuthManager::new("regression-client".to_string(), tx);
        // No streaming session and no Web session: playback must report the
        // missing streaming login instead of borrowing the Web token (which
        // Spotify rejects on the playback services with INVALID_CREDENTIALS).
        let err = auth
            .get_streaming_token()
            .await
            .expect_err("streaming token without streaming login must fail");
        assert!(
            matches!(err, AuthError::StreamingLoginRequired),
            "expected StreamingLoginRequired, got: {err:?}"
        );
    })
    .await;
}

#[tokio::test]
async fn streaming_invalidate_forces_a_fresh_token() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = AuthManager::new("regression-client".to_string(), tx);
        auth.invalidate_token().await;
        assert!(
            auth.streaming_force_refresh.load(Ordering::SeqCst),
            "invalidate must flag the streaming tier for refresh"
        );
    })
    .await;
}

#[tokio::test]
async fn logout_during_the_code_exchange_aborts_the_login() {
    with_memory_storage(|| async {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(web_pkce("slow-csrf"));
            s.last_auth_url = Some("http://127.0.0.1:8989/callback".to_string());
        }

        let exchanging = {
            let auth = std::sync::Arc::clone(&auth);
            tokio::spawn(async move {
                auth.complete_flow("slow-exchange-test", "slow-csrf", 8989)
                    .await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        let logout = auth.logout().await.expect("logout");
        assert_eq!(logout.state, AuthState::Unauthenticated);

        let result = exchanging.await.expect("exchange task");
        assert!(
            matches!(result, Err(AuthError::Superseded)),
            "a callback that outlives logout must be discarded, got: {result:?}"
        );
        let snap = auth.status().await;
        assert_eq!(snap.state, AuthState::Unauthenticated);
        assert!(
            snap.account_id.is_none(),
            "a logged-out session must not be resurrected by a late callback"
        );

        let mut saw_completed = false;
        while let Ok(line) = rx.try_recv() {
            if line.contains("\"auth.completed\"") {
                saw_completed = true;
            }
        }
        assert!(
            !saw_completed,
            "a superseded login must not emit auth.completed"
        );
    })
    .await;
}

#[tokio::test]
async fn client_id_change_during_the_code_exchange_aborts_the_login() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = std::sync::Arc::new(AuthManager::new("old-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(web_pkce("slow-csrf"));
        }

        let exchanging = {
            let auth = std::sync::Arc::clone(&auth);
            tokio::spawn(async move {
                auth.complete_flow("slow-exchange-test", "slow-csrf", 8989)
                    .await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        auth.set_client_id("new-client".to_string()).await;

        let result = exchanging.await.expect("exchange task");
        assert!(
            matches!(result, Err(AuthError::Superseded)),
            "a token minted for the old client must be discarded, got: {result:?}"
        );
        let snap = auth.status().await;
        assert_ne!(
            snap.state,
            AuthState::Authenticated,
            "client ID reset must not be undone by a late callback"
        );
    })
    .await;
}
