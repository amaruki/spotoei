use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

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

pub const HTML_SUCCESS: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Authenticated Successfully</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .card {
      background: #181818;
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }
    .icon {
      font-size: 48px;
      color: #1DB954;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }
    p {
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .badge {
      display: inline-block;
      background: rgba(29, 185, 84, 0.15);
      color: #1DB954;
      font-weight: 600;
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 9999px;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>Authenticated with Spotify</h1>
    <p>Spotoei has securely linked to your account. You can now close this tab and return to the terminal.</p>
    <div class="badge">READY TO PLAY</div>
  </div>
</body>
</html>"#;

/// Neutral notice page. Used when a browser tab finishes a login that was
/// already handled or replaced: it is not an error the user needs to act on.
pub fn html_notice(title: &str, message: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Login Already Handled</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #181818;
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }}
    p {{
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
  </div>
</body>
</html>"#
    )
}

/// Notice page that forwards the browser to the currently active authorization
/// URL. Used when a stale tab cannot be exchanged: instead of dead-ending the
/// user, continue the login that is actually pending. `location.replace` keeps
/// the notice out of history so the back button cannot bounce back into it.
pub fn html_redirect_notice(title: &str, message: &str, url: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    let safe_url = html_escape(url);
    let js_url = url
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "")
        .replace("</", "<\\/");
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="1; url={safe_url}">
  <title>Spotoei - Continuing Login</title>
  <script>window.location.replace('{js_url}');</script>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #181818;
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }}
    p {{
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 20px 0;
    }}
    a {{
      color: #1DB954;
      font-weight: 600;
      text-decoration: none;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
    <a href="{safe_url}">Continue with the current login &rarr;</a>
  </div>
</body>
</html>"#
    )
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Notice page with a manual link but no automatic navigation. Used after an
/// auto-forward already bounced back, so the browser cannot loop.
pub fn html_link_notice(title: &str, message: &str, url: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    let safe_url = html_escape(url);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Continue Login</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #181818;
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }}
    p {{
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 20px 0;
    }}
    a {{
      color: #1DB954;
      font-weight: 600;
      text-decoration: none;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
    <a href="{safe_url}">Open the current login &rarr;</a>
  </div>
</body>
</html>"#
    )
}
pub fn html_error(title: &str, message: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Authentication Error</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #181818;
      border: 1px solid #E22134;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #E22134;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }}
    p {{
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#9888;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
  </div>
</body>
</html>"#
    )
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
