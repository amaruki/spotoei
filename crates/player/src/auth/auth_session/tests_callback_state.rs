use super::super::manager::AuthManager;
use super::super::types::{AccessToken, AuthFlow, AuthState};
use super::{read_one_http_response, web_pkce, with_memory_storage};

#[tokio::test]
async fn duplicate_callbacks_share_the_first_completion_result() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut state = auth.state.lock().await;
            state.state = AuthState::Authenticating;
            state.pkce = Some(super::super::types::PkceTx {
                verifier: "verifier".to_string(),
                state: "duplicate-csrf".to_string(),
                flow: AuthFlow::Web,
            });
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let port = listener.local_addr().expect("local addr").port();
        let (_cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let server = std::sync::Arc::clone(&auth);
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_callback(listener, port, "duplicate-csrf".to_string(), cancel_rx)
                .await;
        });

        let mut first = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("first connect");
        let mut second = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("second connect");
        let partial = b"GET /login?code=callback-lifetime-test&state=duplicate-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n";
        first.write_all(partial).await.expect("first partial write");
        second
            .write_all(partial)
            .await
            .expect("second partial write");
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        first.write_all(b"\r\n").await.expect("finish first request");
        second
            .write_all(b"\r\n")
            .await
            .expect("finish second request");

        let first_read = async {
            let mut response = Vec::new();
            first.read_to_end(&mut response).await.expect("first read");
            String::from_utf8_lossy(&response).into_owned()
        };
        let second_read = async {
            let mut response = Vec::new();
            second
                .read_to_end(&mut response)
                .await
                .expect("second read");
            String::from_utf8_lossy(&response).into_owned()
        };
        let (first_response, second_response) = tokio::join!(first_read, second_read);
        assert!(first_response.contains("200 OK"), "{first_response}");
        assert!(second_response.contains("200 OK"), "{second_response}");
        // Both responses must close their connection: a browser reusing a
        // completed flow's connection would hit that flow's stale closure.
        assert!(
            first_response
                .to_lowercase()
                .contains("connection: close"),
            "{first_response}"
        );
        assert!(
            second_response
                .to_lowercase()
                .contains("connection: close"),
            "{second_response}"
        );
        handle.await.expect("callback listener completion");
    })
    .await;
}

#[tokio::test]
async fn callback_on_an_old_listener_completes_the_live_flow() {
    use tokio::io::AsyncWriteExt;

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut state = auth.state.lock().await;
            state.state = AuthState::Authenticating;
            state.pkce = Some(web_pkce("old-csrf"));
            state.last_auth_url = Some(
                "https://accounts.spotify.com/authorize?client_id=x&state=old-csrf".to_string(),
            );
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let port = listener.local_addr().expect("local addr").port();
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let server = std::sync::Arc::clone(&auth);
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_callback(listener, port, "old-csrf".to_string(), cancel_rx)
                .await;
        });

        // A newer login replaces the transaction while the old listener (and
        // any browser connection to it) is still alive. This is exactly what
        // happens when step 1 completes and step 2 starts on the same origin.
        {
            let mut state = auth.state.lock().await;
            state.pkce = Some(web_pkce("new-csrf"));
            state.last_auth_url = Some(
                "https://accounts.spotify.com/authorize?client_id=x&state=new-csrf".to_string(),
            );
        }

        // The live flow's callback arrives on a connection accepted by the
        // old listener. It must complete the live flow, never expire.
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        stream
            .write_all(
                b"GET /callback?code=callback-lifetime-test&state=new-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            )
            .await
            .expect("write");
        let response = read_one_http_response(&mut stream).await;
        let _ = cancel_tx.send(());
        handle.abort();

        assert!(
            response.contains("200 OK") && response.contains("Authenticated with Spotify"),
            "a live callback served by an older listener must complete, got: {response}"
        );
        assert!(
            response.to_lowercase().contains("connection: close"),
            "{response}"
        );
        assert_eq!(
            auth.state
                .lock()
                .await
                .current
                .as_ref()
                .map(|token| token.account_id.as_str()),
            Some("callback-test-user"),
            "the live login must land in the session"
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
        assert!(super::super::storage::save_session(&token).await.is_err());
        assert!(super::super::storage::save_streaming_session(&token)
            .await
            .is_err());
        assert!(super::super::storage::load_session("test-client")
            .await
            .is_err());
        assert!(
            super::super::storage::load_streaming_session_for("test-user")
                .await
                .expect("memory storage read")
                .is_none()
        );
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
    assert!(super::super::storage::credential_matches_client(
        &token,
        "issuer-client"
    ));
    assert!(!super::super::storage::credential_matches_client(
        &token,
        "other-client"
    ));
}
