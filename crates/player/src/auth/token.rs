use tracing::warn;

use super::constants::{
    now_ms, KEYMASTER_CLIENT_ID, KEYMASTER_PATH, NCSPOT_CLIENT_ID, REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
use super::manager::AuthManager;
use super::storage;
use super::types::{AccessToken, AuthError, AuthState, RefreshedToken, TokenResponse};

impl AuthManager {
    /// Return a usable access token, refreshing when expired. The token value
    /// is returned only to the in-process call; it is never written to logs.
    pub async fn get_web_token(&self) -> Result<(String, u64), AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.get_web_token_mock().await;
        }
        let _guard = self.refresh_lock.lock().await;
        let at = {
            let s = self.state.lock().await;
            let at = s.current.clone().ok_or(AuthError::NotAuthenticated)?;
            if at.expires_at > now_ms() + 30_000 {
                return Ok((at.access_token, at.expires_at));
            }
            at
        };
        let refreshed = match self.refresh(&at.refresh_token).await {
            Ok(r) => r,
            Err(e) => {
                let snap = {
                    let mut s = self.state.lock().await;
                    s.state = AuthState::RefreshFailed;
                    self.snapshot_locked(&s, None)
                };
                if let Ok(value) = serde_json::to_value(&snap) {
                    self.emit("auth.changed", value).await;
                }
                return Err(e);
            }
        };
        let mut new_at = at.clone();
        new_at.access_token = refreshed.access_token.clone();
        new_at.expires_at = refreshed.expires_at;
        new_at.refresh_token = if !refreshed.refresh_token.trim().is_empty() {
            refreshed.refresh_token.clone()
        } else {
            at.refresh_token.clone()
        };
        let token_for_return = new_at.access_token.clone();
        let expires_at = new_at.expires_at;
        let mut s = self.state.lock().await;
        s.current = Some(new_at.clone());
        s.state = AuthState::Authenticated;
        drop(s);
        if let Err(e) = storage::save_session(&new_at).await {
            warn!(error = %e, "session save on refresh failed");
        }
        Ok((token_for_return, expires_at))
    }

    /// Return a usable access token minted specifically for the Keymaster client ID,
    /// used exclusively by Librespot AP & login5 streaming audio decryption.
    pub async fn get_streaming_token(&self) -> Result<(String, u64), AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.get_web_token_mock().await;
        }
        let _guard = self.refresh_lock.lock().await;
        if let Ok(Some(st)) = storage::load_streaming_session().await {
            if st.expires_at > now_ms() + 30_000 {
                return Ok((st.access_token, st.expires_at));
            }
            if !st.refresh_token.trim().is_empty() {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .map_err(|e| AuthError::Http(e.to_string()))?;
                let body = [
                    ("grant_type", "refresh_token"),
                    ("refresh_token", st.refresh_token.as_str()),
                    ("client_id", KEYMASTER_CLIENT_ID),
                ];
                let resp = client
                    .post(format!("{SPOTIFY_ACCOUNTS}/api/token"))
                    .form(&body)
                    .send()
                    .await
                    .map_err(|e| AuthError::Http(e.to_string()))?;
                if resp.status().is_success() {
                    if let Ok(parsed) = resp.json::<TokenResponse>().await {
                        let new_at = AccessToken {
                            access_token: parsed.access_token.clone(),
                            refresh_token: parsed.refresh_token.unwrap_or(st.refresh_token),
                            expires_at: now_ms() + parsed.expires_in * 1000,
                            account_id: st.account_id,
                            scopes: st.scopes,
                        };
                        let _ = storage::save_streaming_session(&new_at).await;
                        return Ok((new_at.access_token, new_at.expires_at));
                    }
                }
            }
        }
        // Fall back to the primary token if no separate streaming token exists yet
        drop(_guard);
        self.get_web_token().await
    }

    async fn get_web_token_mock(&self) -> Result<(String, u64), AuthError> {
        let s = self.state.lock().await;
        let at = s.current.as_ref().ok_or(AuthError::NotAuthenticated)?;
        Ok((at.access_token.clone(), at.expires_at))
    }

    pub(super) async fn exchange_code_with_client(
        &self,
        client_id: &str,
        code: &str,
        verifier: &str,
        host: &str,
        port: u16,
    ) -> Result<(AccessToken, String), AuthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AuthError::Http(e.to_string()))?;
        let is_login_path = client_id == KEYMASTER_CLIENT_ID || client_id == NCSPOT_CLIENT_ID;
        let redirect_path = if is_login_path {
            KEYMASTER_PATH
        } else {
            REDIRECT_PATH
        };
        let redirect_uri = format!("http://{host}:{port}{redirect_path}");
        let body = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ];
        let resp = client
            .post(format!("{SPOTIFY_ACCOUNTS}/api/token"))
            .form(&body)
            .send()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AuthError::Http(format!("status {status}: {text}")));
        }
        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        let account_id = fetch_spotify_user_id(&parsed.access_token)
            .await
            .unwrap_or_else(|| "default".to_string());
        let at = AccessToken {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token.unwrap_or_default(),
            expires_at: now_ms() + parsed.expires_in * 1000,
            account_id: account_id.clone(),
            scopes: parsed
                .scope
                .map(|s| s.split(' ').map(String::from).collect())
                .unwrap_or_default(),
        };
        Ok((at, account_id))
    }

    pub(super) async fn refresh(&self, refresh_token: &str) -> Result<RefreshedToken, AuthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AuthError::Http(e.to_string()))?;
        let client_id = self.client_id.read().await.clone();
        let body = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &client_id),
        ];
        let resp = client
            .post(format!("{SPOTIFY_ACCOUNTS}/api/token"))
            .form(&body)
            .send()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(AuthError::Http(format!("refresh status {}", resp.status())));
        }
        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|e| AuthError::Http(e.to_string()))?;
        Ok(RefreshedToken {
            access_token: parsed.access_token,
            expires_at: now_ms() + parsed.expires_in * 1000,
            refresh_token: match &parsed.refresh_token {
                Some(rt) if !rt.trim().is_empty() => rt.clone(),
                _ => refresh_token.to_string(),
            },
        })
    }
}

/// Resolve the Spotify user id for a fresh access token so per-account caches
/// stay isolated. Falls back to `None` when the profile request fails; the
/// caller keeps the previous placeholder instead of failing the login.
async fn fetch_spotify_user_id(access_token: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;
    body.get("id")?
        .as_str()
        .map(String::from)
        .filter(|id| !id.trim().is_empty())
}

/// Map an [`AuthError`] to the slim `{ reason, message }` shape the
/// protocol uses for the `auth.failed` event. The TUI can render the
/// reason as an icon and surface the message verbatim.
pub fn classify_auth_failure(e: &AuthError) -> (&'static str, String) {
    match e {
        AuthError::OAuth(msg) if msg == "state mismatch" => ("state_mismatch", msg.clone()),
        AuthError::OAuth(msg) if msg == "no in-flight PKCE tx" => {
            ("other", "no in-flight authentication request".to_string())
        }
        AuthError::OAuth(msg) if msg.contains("denied") || msg.contains("access_denied") => {
            ("user_denied", msg.clone())
        }
        AuthError::OAuth(msg) => ("other", msg.clone()),
        AuthError::Http(msg) if msg.contains("status ") => ("token_exchange", msg.clone()),
        AuthError::Http(msg) => ("network", msg.clone()),
        _ => ("other", e.to_string()),
    }
}
