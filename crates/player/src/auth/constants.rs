use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

mod notices;
mod pages;

pub use notices::{html_link_notice, html_notice, html_redirect_notice};
pub use pages::{html_error, HTML_SUCCESS};

pub const KEYRING_SERVICE: &str = "spotoei";
pub const SPOTIFY_ACCOUNTS: &str = "https://accounts.spotify.com";
pub const REDIRECT_PATH: &str = "/callback";
pub const KEYMASTER_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
pub const NCSPOT_CLIENT_ID: &str = "d420a117a32841c2b3474932e49fb54b";
pub const USER_DEV_CLIENT_ID: &str = "8b16519257c2463eb13dbd0bba657fed";
pub const KEYMASTER_PORT: u16 = 8989;
pub const KEYMASTER_PATH: &str = "/login";

pub const DEFAULT_SCOPES: &[&str] = &[
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-library-read",
    "user-library-modify",
    "user-follow-read",
    "user-follow-modify",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-top-read",
    "user-read-recently-played",
    "streaming",
    "user-read-private",
];

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn generate_verifier() -> String {
    let mut buf = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn s256_challenge(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

pub fn generate_state() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn url_decode(q: &str) -> std::collections::HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| {
            let mut it = kv.splitn(2, '=');
            let k = it.next()?.to_string();
            let v = it.next().unwrap_or("").to_string();
            Some((
                urlencoding::decode(&k).ok()?.into_owned(),
                urlencoding::decode(&v).ok()?.into_owned(),
            ))
        })
        .collect()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn default_scopes_cover_home_endpoints() {
        assert!(super::DEFAULT_SCOPES.contains(&"user-top-read"));
        assert!(super::DEFAULT_SCOPES.contains(&"user-read-recently-played"));
        assert!(super::DEFAULT_SCOPES.contains(&"user-library-modify"));
        assert!(super::DEFAULT_SCOPES.contains(&"playlist-modify-private"));
        assert!(super::DEFAULT_SCOPES.contains(&"user-read-private"));
    }

    #[test]
    fn redirect_notice_escapes_the_authorization_url() {
        let html = super::html_redirect_notice(
            "Login Tab Expired",
            "message",
            "https://accounts.spotify.com/authorize?client_id=x&state=abc",
        );
        assert!(
            html.contains("url=https://accounts.spotify.com/authorize?client_id=x&amp;state=abc"),
            "meta refresh URL must be HTML-escaped: {html}"
        );
        assert!(
            html.contains(
                "window.location.replace('https://accounts.spotify.com/authorize?client_id=x&state=abc')"
            ),
            "JS redirect must carry the raw URL: {html}"
        );
    }
}
