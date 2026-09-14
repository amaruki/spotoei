use super::super::manager::AuthManager;
use super::super::types::AuthState;
use super::{port_from_auth_url, read_one_http_response, web_pkce, with_memory_storage};

#[tokio::test]
async fn superseded_callback_gets_a_neutral_page() {
    use tokio::io::AsyncWriteExt;

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(web_pkce("live-csrf"));
            s.recent_states.push(super::super::types::RecentState {
                state: "old-csrf".to_string(),
                at_ms: super::super::constants::now_ms(),
            });
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let port = listener.local_addr().expect("local addr").port();
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let server = std::sync::Arc::clone(&auth);
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_callback(listener, port, "live-csrf".to_string(), cancel_rx)
                .await;
        });

        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        stream
            .write_all(
                b"GET /callback?code=abc&state=old-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            )
            .await
            .expect("write");
        let response = read_one_http_response(&mut stream).await;
        let _ = cancel_tx.send(());
        handle.abort();

        assert!(
            response.contains("200"),
            "a recognized superseded tab must not see an error page: {response}"
        );
        assert!(
            response.contains("Login Already Handled"),
            "expected the neutral notice page, got: {response}"
        );
        let s = auth.state.lock().await;
        assert!(
            s.pkce.as_ref().map(|p| p.state.as_str()) == Some("live-csrf"),
            "the live flow must survive a stale tab callback"
        );
    })
    .await;
}

#[tokio::test]
async fn callback_from_a_replaced_flow_gets_the_neutral_page() {
    use tokio::io::AsyncWriteExt;

    with_memory_storage(|| async {
        let old_port_env = std::env::var("SPOTOEI_REDIRECT_PORT").ok();
        std::env::set_var("SPOTOEI_REDIRECT_PORT", "0");

        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = std::sync::Arc::new(AuthManager::new("personal-client".to_string(), tx));

        // First login: a real listener on an ephemeral port.
        let first = auth.begin(None).await.expect("first begin");
        let first_url = first.auth_url.clone().expect("first auth url");
        let first_port = port_from_auth_url(&first_url);
        let first_state = auth
            .state
            .lock()
            .await
            .pkce
            .as_ref()
            .expect("first pkce")
            .state
            .clone();

        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", first_port))
            .await
            .expect("connect first listener");
        stream
            .write_all(
                format!(
                    "GET /callback?code=callback-lifetime-test&state={first_state} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .expect("write first callback");
        let response = read_one_http_response(&mut stream).await;
        assert!(response.contains("200 OK"), "first login failed: {response}");

        // A new login (e.g. the automatic streaming step) replaces the listener.
        let second = auth.begin_streaming().await.expect("second begin");
        let second_url = second.auth_url.clone().expect("second auth url");
        let second_port = port_from_auth_url(&second_url);
        assert!(
            second.pending,
            "the streaming flow must be reported as pending before any callback"
        );

        // The stale browser tab completes against the new listener: it must
        // get the calm notice, not the state-mismatch error.
        let mut stale = tokio::net::TcpStream::connect(("127.0.0.1", second_port))
            .await
            .expect("connect second listener");
        stale
            .write_all(
                format!(
                    "GET /callback?code=callback-lifetime-test&state={first_state} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .expect("write stale callback");
        let response = read_one_http_response(&mut stale).await;
        assert!(
            response.contains("200 OK"),
            "stale tab must not see an error: {response}"
        );
        assert!(
            response.contains("Login Already Handled"),
            "stale tab must see the neutral page: {response}"
        );

        match old_port_env {
            Some(value) => std::env::set_var("SPOTOEI_REDIRECT_PORT", value),
            None => std::env::remove_var("SPOTOEI_REDIRECT_PORT"),
        }
    })
    .await;
}
