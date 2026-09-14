use super::super::manager::AuthManager;
use super::super::oauth_flow::resolve_exchange_target;
use super::super::types::{AccessToken, AuthError, AuthFlow, AuthState};
use super::{expired_token, with_memory_storage};

#[test]
fn streaming_completion_uses_the_keymaster_client() {
    let (client, is_streaming) = resolve_exchange_target(AuthFlow::Streaming, "whatever-client");
    assert_eq!(client, super::super::constants::KEYMASTER_CLIENT_ID);
    assert!(is_streaming);
}
#[test]
fn streaming_login_requests_full_metadata_scopes() {
    let scopes = super::super::oauth_flow::STREAMING_SCOPES;
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
        "user-read-private",
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
    let (client, is_streaming) =
        resolve_exchange_target(AuthFlow::Web, super::super::constants::KEYMASTER_CLIENT_ID);
    assert_eq!(client, super::super::constants::KEYMASTER_CLIENT_ID);
    assert!(!is_streaming);
}

#[test]
fn account_conflict_requires_two_known_account_ids() {
    let streaming_account = "user-1";
    assert!(
        !super::super::oauth_flow::account_conflict(None, streaming_account),
        "an unknown account must not create a false mismatch"
    );
    assert!(
        !super::super::oauth_flow::account_conflict(Some("user-1"), streaming_account),
        "same-account streaming top-up must stay accepted"
    );
    assert!(
        super::super::oauth_flow::account_conflict(Some("user-2"), streaming_account),
        "a genuinely different web account must still be rejected"
    );
}

#[test]
fn account_conflict_treats_default_sentinel_as_non_conflicting() {
    // When /v1/me fails (missing scope, rate limit, offline), the token
    // exchange falls back to "default". This placeholder must NEVER conflict
    // with a real user ID, otherwise streaming login fails as a mismatch.
    assert!(
        !super::super::oauth_flow::account_conflict(Some("default"), "lt43ui36u1dp7b0w8giykp19f"),
        "default web account must not conflict with incoming real account"
    );
    assert!(
        !super::super::oauth_flow::account_conflict(Some("lt43ui36u1dp7b0w8giykp19f"), "default"),
        "real web account must not conflict with incoming default fallback"
    );
    assert!(
        !super::super::oauth_flow::account_conflict(Some("default"), "default"),
        "default and default must not conflict"
    );
    assert!(
        super::super::oauth_flow::account_conflict(Some("user-1"), "user-2"),
        "two genuinely different accounts must still conflict"
    );
}

#[test]
fn reconcile_streaming_account_adopts_active_web_user() {
    // When Keymaster token has "default" because profile lookup was unavailable,
    // but a Web login is already active, streaming must bind to that web account.
    let reconciled = super::super::oauth_flow::reconcile_streaming_account(
        Some("lt43ui36u1dp7b0w8giykp19f"),
        "default",
    );
    assert_eq!(reconciled, "lt43ui36u1dp7b0w8giykp19f");

    let kept_real = super::super::oauth_flow::reconcile_streaming_account(
        Some("lt43ui36u1dp7b0w8giykp19f"),
        "lt43ui36u1dp7b0w8giykp19f",
    );
    assert_eq!(kept_real, "lt43ui36u1dp7b0w8giykp19f");

    let no_web = super::super::oauth_flow::reconcile_streaming_account(None, "default");
    assert_eq!(no_web, "default");

    let discovered = super::super::oauth_flow::reconcile_streaming_account(
        Some("default"),
        "lt43ui36u1dp7b0w8giykp19f",
    );
    assert_eq!(discovered, "lt43ui36u1dp7b0w8giykp19f");
    assert!(super::super::oauth_flow::should_upgrade_web_account(
        Some("default"),
        discovered,
    ));
    assert!(!super::super::oauth_flow::should_upgrade_web_account(
        Some("lt43ui36u1dp7b0w8giykp19f"),
        discovered,
    ));
}

#[test]
fn web_completion_keeps_only_a_same_account_streaming_session() {
    // Explicit Web reauthorization for the same user must not discard the
    // valid streaming session. Only an account switch may drop it.
    let fresh_web_account = "user-1";
    let keep = |stored: Option<&str>| stored.is_some_and(|prev| prev == fresh_web_account);
    assert!(keep(Some("user-1")), "same-account session must survive");
    assert!(
        !keep(Some("user-2")),
        "other-account session must be dropped"
    );
    assert!(!keep(None), "nothing to keep without a stored session");
}

#[tokio::test]
async fn streaming_login_replaces_the_finished_web_callback_transaction() {
    with_memory_storage(|| async {
        // Ephemeral port so the suite never fights a running app for 8989.
        let old_port = std::env::var("SPOTOEI_REDIRECT_PORT").ok();
        std::env::set_var("SPOTOEI_REDIRECT_PORT", "0");
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new(
            super::super::constants::NCSPOT_CLIENT_ID.to_string(),
            tx,
        ));

        auth.begin(None).await.expect("begin web login");
        let web_state = auth
            .state
            .lock()
            .await
            .pkce
            .as_ref()
            .expect("web PKCE transaction")
            .state
            .clone();
        {
            let mut state = auth.state.lock().await;
            state.current = Some(AccessToken {
                access_token: "web-access".to_string(),
                refresh_token: "web-refresh".to_string(),
                expires_at: super::super::constants::now_ms() + 3_600_000,
                account_id: "test-user".to_string(),
                scopes: vec![],
                client_id: super::super::constants::NCSPOT_CLIENT_ID.to_string(),
            });
            state.state = AuthState::Authenticated;
        }

        auth.begin_streaming().await.expect("begin streaming login");
        let state = auth.state.lock().await;
        assert!(
            state.find_pkce(&web_state).is_none(),
            "the completed Web callback must not remain valid after streaming login starts"
        );
        assert!(
            state
                .pkce
                .as_ref()
                .is_some_and(|transaction| transaction.flow == AuthFlow::Streaming),
            "the replacement listener must own the streaming transaction"
        );
        drop(state);
        auth.cancel_in_flight().await;
        match old_port {
            Some(value) => std::env::set_var("SPOTOEI_REDIRECT_PORT", value),
            None => std::env::remove_var("SPOTOEI_REDIRECT_PORT"),
        }
    })
    .await;
}

#[tokio::test]
async fn streaming_login_requires_a_completed_web_session() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = std::sync::Arc::new(AuthManager::new(
            super::super::constants::NCSPOT_CLIENT_ID.to_string(),
            tx,
        ));
        let error = auth
            .begin_streaming()
            .await
            .expect_err("streaming must not start before Web authentication completes");
        assert!(matches!(error, AuthError::NotAuthenticated));
        assert!(auth.state.lock().await.pkce.is_none());
    })
    .await;
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
            s.pkce = Some(super::super::types::PkceTx {
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
