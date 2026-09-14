use super::super::constants::{
    now_ms, KEYMASTER_CLIENT_ID, KEYMASTER_PATH, NCSPOT_CLIENT_ID, REDIRECT_PATH, SPOTIFY_ACCOUNTS,
};
use super::super::manager::AuthManager;
use super::super::types::{AccessToken, AuthError, RefreshedToken, TokenResponse};

impl AuthManager {
    pub(in crate::auth) async fn exchange_code_with_client(
        &self,
        client_id: &str,
        code: &str,
        verifier: &str,
        host: &str,
        port: u16,
    ) -> Result<(AccessToken, String), AuthError> {
        #[cfg(test)]
        if code == "callback-lifetime-test" {
            let account_id = "callback-test-user".to_string();
            return Ok((
                AccessToken {
                    access_token: "callback-test-access".to_string(),
                    refresh_token: "callback-test-refresh".to_string(),
                    expires_at: now_ms() + 3_600_000,
                    account_id: account_id.clone(),
                    scopes: vec!["user-read-private".to_string()],
                    client_id: client_id.to_string(),
                },
                account_id,
            ));
        }
        #[cfg(test)]
        if code == "slow-exchange-test" {
            // Simulates a token exchange that is still on the wire while the
            // user signs out or starts another login.
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            let account_id = "slow-test-user".to_string();
            return Ok((
                AccessToken {
                    access_token: "slow-test-access".to_string(),
                    refresh_token: "slow-test-refresh".to_string(),
                    expires_at: now_ms() + 3_600_000,
                    account_id: account_id.clone(),
                    scopes: vec!["user-read-private".to_string()],
                    client_id: client_id.to_string(),
                },
                account_id,
            ));
        }
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
            client_id: client_id.to_string(),
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
/// stay isolated. Rate limiting is common right after a login burst, so a
/// couple of short retries avoid binding the whole session to the "default"
/// placeholder (which later forces an unnecessary streaming re-login).
async fn fetch_spotify_user_id(access_token: &str) -> Option<String> {
    for attempt in 0..3u32 {
        if let Some(id) = fetch_spotify_user_id_once(access_token).await {
            return Some(id);
        }
        if attempt < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(
                500 * u64::from(attempt + 1),
            ))
            .await;
        }
    }
    None
}

async fn fetch_spotify_user_id_once(access_token: &str) -> Option<String> {
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
    body.get("id")
        .or_else(|| body.get("account_id"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .filter(|id| !id.trim().is_empty())
}
