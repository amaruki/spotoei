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

use std::sync::atomic::Ordering;

use super::manager::AuthManager;
use super::oauth_flow::resolve_exchange_target;
use super::types::{AccessToken, AuthError, AuthFlow, AuthState, Storage};

static TEST_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Run `f` with keyring-backed storage disabled so tests never touch the
/// developer's real credential store.
async fn with_memory_storage<Fut, T>(f: impl FnOnce() -> Fut) -> T
where
    Fut: std::future::Future<Output = T>,
{
    let _guard = TEST_ENV_LOCK.lock().await;
    let old_storage = std::env::var("SPOTOEI_AUTH_STORAGE").ok();
    let old_mock = std::env::var("SPOTOEI_MOCK_AUTH").ok();
    std::env::set_var("SPOTOEI_AUTH_STORAGE", "memory");
    std::env::remove_var("SPOTOEI_MOCK_AUTH");
    let out = f().await;
    match old_storage {
        Some(v) => std::env::set_var("SPOTOEI_AUTH_STORAGE", v),
        None => std::env::remove_var("SPOTOEI_AUTH_STORAGE"),
    }
    match old_mock {
        Some(v) => std::env::set_var("SPOTOEI_MOCK_AUTH", v),
        None => std::env::remove_var("SPOTOEI_MOCK_AUTH"),
    }
    out
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn expired_token() -> AccessToken {
    AccessToken {
        access_token: "expired-access".to_string(),
        refresh_token: "invalid-refresh-token".to_string(),
        expires_at: 1,
        account_id: "default".to_string(),
        scopes: vec![],
        client_id: "regression-client".to_string(),
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

#[test]
fn streaming_completion_uses_the_keymaster_client() {
    let (client, is_streaming) = resolve_exchange_target(AuthFlow::Streaming, "whatever-client");
    assert_eq!(client, super::constants::KEYMASTER_CLIENT_ID);
    assert!(is_streaming);
}
#[test]
fn streaming_login_requests_full_metadata_scopes() {
    let scopes = super::oauth_flow::STREAMING_SCOPES;
    let required = [
        "streaming",
        "user-read-playback-state",
        "user-modify-playback-state",
        "playlist-read-private",
        "playlist-read-collaborative",
        "user-library-read",
        "user-read-playback-position",
        "user-top-read",
        "user-read-recently-played",
    ];
    for scope in &required {
        assert!(
            scopes.contains(scope),
            "missing required streaming scope: {scope}"
        );
    }
}

#[test]
fn web_completion_uses_the_configured_client() {
    let (client, is_streaming) = resolve_exchange_target(AuthFlow::Web, "dev-client-123");
    assert_eq!(client, "dev-client-123");
    assert!(!is_streaming);
}

#[test]
fn web_login_with_keymaster_client_stays_a_web_login() {
    // Regression: the old URL-substring detector routed a Web login through
    // the streaming store whenever the configured client was Keymaster, so
    // the app never became authenticated.
    let (client, is_streaming) = resolve_exchange_target(
        AuthFlow::Web,
        super::constants::KEYMASTER_CLIENT_ID,
    );
    assert_eq!(client, super::constants::KEYMASTER_CLIENT_ID);
    assert!(!is_streaming);
}

#[tokio::test]
async fn failed_exchange_restores_the_previous_session() {
    // A Web-authed user starts a streaming login; the code exchange fails
    // (bad verifier, network, revoked grant). The app must fall back to
    // Authenticated-with-session instead of stranding the UI on
    // "authenticating" with a dead PKCE transaction nobody can complete.
    with_memory_storage(|| async {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = AuthManager::new("regression-client".to_string(), tx);
        {
            let mut s = auth.state.lock().await;
            s.current = Some(AccessToken {
                expires_at: 9_999_999_999_999,
                ..expired_token()
            });
            s.state = AuthState::Authenticating;
            s.pkce = Some(super::types::PkceTx {
                verifier: "verifier".to_string(),
                state: "csrf".to_string(),
                flow: AuthFlow::Streaming,
            });
            s.last_auth_url = Some("http://127.0.0.1:8989/login".to_string());
        }
        let err = auth
            .complete_flow("bad-code", "csrf", 8989)
            .await
            .expect_err("exchange with a bogus code must fail");
        let _ = err;
        let snap = auth.status().await;
        assert_eq!(
            snap.state,
            AuthState::Authenticated,
            "previous session must survive a failed exchange"
        );
        assert!(
            snap.auth_url.is_none(),
            "dead auth URL must be cleared so the next press starts fresh"
        );
        let mut saw_restored = false;
        let deadline = tokio::time::sleep(std::time::Duration::from_millis(500));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                line = rx.recv() => {
                    let Some(line) = line else { break };
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    if v.get("event").and_then(|e| e.as_str()) == Some("auth.changed")
                        && v.get("data").and_then(|d| d.get("state")).and_then(|s| s.as_str()) == Some("authenticated")
                    {
                        saw_restored = true;
                        break;
                    }
                }
            }
        }
        assert!(saw_restored, "UI must be told the session is back");
    })
    .await;
}

#[tokio::test]
async fn bogus_callback_keeps_the_pending_login_intact() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(super::types::PkceTx {
                verifier: "verifier".to_string(),
                state: "correct-csrf".to_string(),
                flow: AuthFlow::Streaming,
            });
            s.last_auth_url = Some("http://127.0.0.1:0/login".to_string());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let port = listener.local_addr().expect("local addr").port();
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let server = std::sync::Arc::clone(&auth);
        let handle = tokio::spawn(async move {
            let _ = server.serve_callback(listener, port, cancel_rx).await;
        });
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        stream
            .write_all(b"GET /login?code=abc&state=wrong-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .expect("write");
        // Read exactly one response: headers first, then Content-Length bytes.
        // (The server keeps the connection open, so read_to_end would hang.)
        let mut raw = Vec::new();
        let mut buf = [0u8; 1024];
        let header_end = loop {
            let n = stream.read(&mut buf).await.expect("read");
            assert!(n > 0, "server closed connection without responding");
            raw.extend_from_slice(&buf[..n]);
            if let Some(pos) = find_subslice(&raw, b"\r\n\r\n") {
                break pos + 4;
            }
            assert!(raw.len() < 65536, "response headers too large");
        };
        let headers = String::from_utf8_lossy(&raw[..header_end]);
        let content_length: usize = headers
            .lines()
            .filter_map(|line| line.strip_prefix("content-length:"))
            .find_map(|v| v.trim().parse().ok())
            .unwrap_or(0);
        while raw.len() < header_end + content_length {
            let n = stream.read(&mut buf).await.expect("read body");
            assert!(n > 0, "server closed connection mid-body");
            raw.extend_from_slice(&buf[..n]);
        }
        let text = String::from_utf8_lossy(&raw);
        let _ = cancel_tx.send(());
        handle.abort();
        assert!(
            text.contains("400"),
            "bogus callback must be rejected, got: {text}"
        );
        let s = auth.state.lock().await;
        assert!(
            s.pkce.as_ref().map(|p| p.state.as_str()) == Some("correct-csrf"),
            "pending login must survive a bogus callback so the newest tab still works"
        );
    })
    .await;
}

#[tokio::test]
async fn memory_storage_never_persists_credentials() {
    let token = AccessToken {
        access_token: "test-access".to_string(),
        refresh_token: "test-refresh".to_string(),
        expires_at: 9_999_999_999_999,
        account_id: "test-user".to_string(),
        scopes: vec!["streaming".to_string()],
        client_id: "test-client".to_string(),
    };

    with_memory_storage(|| async {
        assert!(super::storage::save_session(&token).await.is_err());
        assert!(super::storage::save_streaming_session(&token).await.is_err());
        assert!(super::storage::load_session("test-client").await.is_err());
        assert!(super::storage::load_streaming_session_for("test-user")
            .await
            .expect("memory storage read")
            .is_none());
    })
    .await;
}

#[test]
fn credential_is_bound_to_the_issuing_client() {
    let token = AccessToken {
        access_token: "test-access".to_string(),
        refresh_token: "test-refresh".to_string(),
        expires_at: 9_999_999_999_999,
        account_id: "test-user".to_string(),
        scopes: vec![],
        client_id: "issuer-client".to_string(),
    };
    assert!(super::storage::credential_matches_client(&token, "issuer-client"));
    assert!(!super::storage::credential_matches_client(&token, "other-client"));
}

#[tokio::test]
async fn streaming_token_never_borrows_web_token_with_streaming_scope() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = AuthManager::new(super::constants::NCSPOT_CLIENT_ID.to_string(), tx);
        {
            let mut s = auth.state.lock().await;
            s.current = Some(AccessToken {
                access_token: "ncspot-web-token".to_string(),
                refresh_token: "ncspot-web-refresh".to_string(),
                expires_at: super::constants::now_ms() + 3600_000,
                account_id: "test-user".to_string(),
                scopes: vec!["streaming".to_string(), "user-read-playback-state".to_string()],
                client_id: super::constants::NCSPOT_CLIENT_ID.to_string(),
            });
            s.state = AuthState::Authenticated;
        }
        let err = auth
            .get_streaming_token()
            .await
            .expect_err("streaming token must not borrow web token");
        assert!(
            matches!(err, AuthError::StreamingLoginRequired),
            "expected StreamingLoginRequired, got: {err:?}"
        );
        assert!(
            !auth.has_streaming_session().await,
            "has_streaming_session must be false when only web token exists"
        );
    })
    .await;
}
