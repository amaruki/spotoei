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
//!
//! The tests are grouped by concern in sibling files (`tests_lifecycle`,
//! `tests_flow_routing`, `tests_callback`, `tests_callback_state`,
//! `tests_streaming`, `tests_notices`); shared helpers live here.

use super::types::{AccessToken, AuthFlow, PkceTx};

#[cfg(test)]
mod tests_callback;
#[cfg(test)]
mod tests_callback_state;
#[cfg(test)]
mod tests_flow_routing;
#[cfg(test)]
mod tests_lifecycle;
#[cfg(test)]
mod tests_notices;
#[cfg(test)]
mod tests_streaming;

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

async fn read_one_http_response(stream: &mut tokio::net::TcpStream) -> String {
    use tokio::io::AsyncReadExt;

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
    let headers = String::from_utf8_lossy(&raw[..header_end]).to_lowercase();
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
    String::from_utf8_lossy(&raw).into_owned()
}

fn web_pkce(state: &str) -> PkceTx {
    PkceTx {
        verifier: "verifier".to_string(),
        state: state.to_string(),
        flow: AuthFlow::Web,
    }
}

fn port_from_auth_url(url: &str) -> u16 {
    let redirect = url
        .split("redirect_uri=")
        .nth(1)
        .and_then(|rest| rest.split('&').next())
        .unwrap_or_else(|| panic!("auth url has no redirect_uri: {url}"));
    let decoded = urlencoding::decode(redirect)
        .unwrap_or_else(|_| panic!("auth url redirect_uri is not decodable: {url}"))
        .into_owned();
    decoded
        .split("127.0.0.1:")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .and_then(|port| port.parse().ok())
        .unwrap_or_else(|| panic!("auth url contains no loopback port: {url}"))
}
