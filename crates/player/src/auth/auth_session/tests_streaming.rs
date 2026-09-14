use super::super::manager::AuthManager;
use super::super::types::{AccessToken, AuthError, AuthState};
use super::{web_pkce, with_memory_storage};

#[tokio::test]
async fn streaming_token_never_borrows_web_token_with_streaming_scope() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = AuthManager::new(super::super::constants::NCSPOT_CLIENT_ID.to_string(), tx);
        {
            let mut s = auth.state.lock().await;
            s.current = Some(AccessToken {
                access_token: "ncspot-web-token".to_string(),
                refresh_token: "ncspot-web-refresh".to_string(),
                expires_at: super::super::constants::now_ms() + 3600_000,
                account_id: "test-user".to_string(),
                scopes: vec![
                    "streaming".to_string(),
                    "user-read-playback-state".to_string(),
                ],
                client_id: super::super::constants::NCSPOT_CLIENT_ID.to_string(),
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

#[tokio::test]
async fn revoked_streaming_credentials_require_a_new_login() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = AuthManager::new(super::super::constants::NCSPOT_CLIENT_ID.to_string(), tx);
        let token = AccessToken {
            access_token: "streaming-access".to_string(),
            refresh_token: "streaming-refresh".to_string(),
            expires_at: super::super::constants::now_ms() + 3600_000,
            account_id: "test-user".to_string(),
            scopes: vec!["streaming".to_string()],
            client_id: super::super::constants::KEYMASTER_CLIENT_ID.to_string(),
        };
        {
            let mut state = auth.state.lock().await;
            state.current = Some(AccessToken {
                client_id: super::super::constants::NCSPOT_CLIENT_ID.to_string(),
                ..token.clone()
            });
            state.streaming = Some(token);
            state.state = AuthState::Authenticated;
        }
        assert!(auth.has_streaming_session().await);
        auth.clear_revoked_streaming_session().await;
        assert!(!auth.has_streaming_session().await);
    })
    .await;
}

#[tokio::test]
async fn web_login_replaces_streaming_credentials_atomically() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = AuthManager::new("regression-client".to_string(), tx);
        let epoch_before = auth.session_epoch();
        {
            let mut s = auth.state.lock().await;
            s.current = Some(AccessToken {
                access_token: "web-a".to_string(),
                refresh_token: "web-refresh-a".to_string(),
                expires_at: super::super::constants::now_ms() + 3_600_000,
                account_id: "user-a".to_string(),
                scopes: vec![],
                client_id: "regression-client".to_string(),
            });
            s.streaming = Some(AccessToken {
                access_token: "streaming-a".to_string(),
                refresh_token: "streaming-refresh-a".to_string(),
                expires_at: super::super::constants::now_ms() + 3_600_000,
                account_id: "user-a".to_string(),
                scopes: vec![],
                client_id: super::super::constants::KEYMASTER_CLIENT_ID.to_string(),
            });
            s.state = AuthState::Authenticated;
            s.pkce = Some(web_pkce("web-csrf"));
        }

        auth.complete_flow("callback-lifetime-test", "web-csrf", 8989)
            .await
            .expect("web completion");

        let s = auth.state.lock().await;
        assert_eq!(
            s.current.as_ref().map(|token| token.account_id.as_str()),
            Some("callback-test-user"),
            "the web login must own the session"
        );
        assert!(
            s.streaming.is_none(),
            "the previous account's streaming credentials must be dropped"
        );
        assert!(s.pkce.is_none());
        drop(s);
        assert!(
            auth.session_epoch() > epoch_before,
            "playback epoch must bump before the new identity becomes visible"
        );
    })
    .await;
}

#[tokio::test]
async fn streaming_token_from_another_account_is_never_served() {
    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = AuthManager::new("regression-client".to_string(), tx);
        {
            let mut s = auth.state.lock().await;
            s.current = Some(AccessToken {
                access_token: "web-b".to_string(),
                refresh_token: "web-refresh-b".to_string(),
                expires_at: super::super::constants::now_ms() + 3_600_000,
                account_id: "user-b".to_string(),
                scopes: vec![],
                client_id: "regression-client".to_string(),
            });
            s.streaming = Some(AccessToken {
                access_token: "streaming-a".to_string(),
                // Empty refresh token keeps the test off the network.
                refresh_token: String::new(),
                expires_at: super::super::constants::now_ms() + 3_600_000,
                account_id: "user-a".to_string(),
                scopes: vec![],
                client_id: super::super::constants::KEYMASTER_CLIENT_ID.to_string(),
            });
            s.state = AuthState::Authenticated;
        }

        let err = auth
            .get_streaming_token()
            .await
            .expect_err("another account's streaming token must not be served");
        assert!(matches!(err, AuthError::StreamingLoginRequired));
        assert!(
            auth.state.lock().await.streaming.is_none(),
            "the mismatched streaming token must be dropped"
        );
    })
    .await;
}
