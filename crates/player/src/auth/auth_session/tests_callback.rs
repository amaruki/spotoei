use super::super::manager::AuthManager;
use super::super::types::{AuthFlow, AuthState};
use super::{find_subslice, read_one_http_response, web_pkce, with_memory_storage};

#[tokio::test]
async fn previous_run_callback_cannot_complete_the_pending_login() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(super::super::types::PkceTx {
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
            let _ = server
                .serve_callback(listener, port, "correct-csrf".to_string(), cancel_rx)
                .await;
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
            text.contains("200") && text.contains("Login Tab Expired"),
            "an unknown-state redirect must get the expired-tab notice, got: {text}"
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
async fn expired_callback_forwards_the_browser_to_the_active_login() {
    use tokio::io::AsyncWriteExt;

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(64);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut s = auth.state.lock().await;
            s.state = AuthState::Authenticating;
            s.pkce = Some(web_pkce("active-csrf"));
            s.last_auth_url = Some(
                "https://accounts.spotify.com/authorize?client_id=x&state=active-csrf".to_string(),
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
                .serve_callback(listener, port, "active-csrf".to_string(), cancel_rx)
                .await;
        });

        let send_stale = |port: u16| async move {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .expect("connect");
            stream
                .write_all(
                    b"GET /callback?code=stale-code&state=old-run-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write");
            read_one_http_response(&mut stream).await
        };

        let first = send_stale(port).await;
        let second = send_stale(port).await;
        let third = send_stale(port).await;
        let _ = cancel_tx.send(());
        handle.abort();

        assert!(
            first.contains("200") && first.contains("Login Tab Expired"),
            "expired tab must get the neutral notice, got: {first}"
        );
        assert!(
            first.contains("accounts.spotify.com/authorize")
                && first.contains("http-equiv=\"refresh\""),
            "expired tab must be forwarded to the pending login, got: {first}"
        );
        assert!(
            second.contains("http-equiv=\"refresh\""),
            "the second attempt may still auto-forward, got: {second}"
        );
        assert!(
            !third.contains("http-equiv=\"refresh\"")
                && third.contains("Open the current login")
                && third.contains("accounts.spotify.com/authorize"),
            "after a bounce the notice must stop auto-forwarding and offer a link, got: {third}"
        );
        assert!(
            auth.state.lock().await.pkce.as_ref().map(|p| p.state.as_str())
                == Some("active-csrf"),
            "the live flow must survive the forwarded stale callback"
        );
    })
    .await;
}

#[tokio::test]
async fn accepted_callback_finishes_after_listener_shutdown() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    with_memory_storage(|| async {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        let auth = std::sync::Arc::new(AuthManager::new("regression-client".to_string(), tx));
        {
            let mut state = auth.state.lock().await;
            state.state = AuthState::Authenticating;
            state.pkce = Some(super::super::types::PkceTx {
                verifier: "verifier".to_string(),
                state: "accepted-csrf".to_string(),
                flow: AuthFlow::Web,
            });
            state.last_auth_url = Some("http://127.0.0.1:0/login".to_string());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let port = listener.local_addr().expect("local addr").port();
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let server = std::sync::Arc::clone(&auth);
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_callback(listener, port, "accepted-csrf".to_string(), cancel_rx)
                .await;
        });

        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        stream
            .write_all(
                b"GET /login?code=callback-lifetime-test&state=accepted-csrf HTTP/1.1\r\nHost: x\r\nConnection: close\r\n",
            )
            .await
            .expect("write partial callback");
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        let _ = cancel_tx.send(());
        handle.await.expect("callback listener shutdown");
        stream
            .write_all(b"\r\n")
            .await
            .expect("finish callback request");

        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("read callback response");
        let response = String::from_utf8_lossy(&response);
        assert!(
            response.contains("200 OK"),
            "an accepted callback must finish after the listener closes: {response}"
        );
        assert!(
            !response.contains("Spotoei stopped waiting"),
            "an accepted callback must not lose its completion receiver"
        );
    })
    .await;
}
