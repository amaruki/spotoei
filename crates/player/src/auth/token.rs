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
        // A login/logout executed while the refresh was on the wire may have
        // replaced the session. Committing the result then would resurrect the
        // previous identity and overwrite the newer credentials on disk.
        if s.current
            .as_ref()
            .map(|current| current.refresh_token.as_str())
            != Some(at.refresh_token.as_str())
        {
            return Err(AuthError::NotAuthenticated);
        }
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
    /// Never falls back to the Web token: the two tiers belong to different
    /// clients, and Spotify rejects a Web token on the playback services
    /// with `INVALID_CREDENTIALS`. Callers translate the missing-login error
    /// into a prompt to complete the streaming login (Step 2/2).
    pub async fn get_streaming_token(&self) -> Result<(String, u64), AuthError> {
        if std::env::var("SPOTOEI_MOCK_AUTH").is_ok() {
            return self.get_web_token_mock().await;
        }
        let _guard = self.refresh_lock.lock().await;
        // An invalidation (e.g. playback rejected the token) forces a refresh
        // instead of serving the cached streaming token again.
        let force_refresh = self
            .streaming_force_refresh
            .swap(false, std::sync::atomic::Ordering::SeqCst);
        let epoch = self.session_epoch();
        let (current_account, stored) = {
            let mut s = self.state.lock().await;
            let current_account = s.current.as_ref().map(|token| token.account_id.clone());
            let matching = match (current_account.as_deref(), s.streaming.as_ref()) {
                (Some(current), Some(streaming)) if streaming.account_id == current => {
                    Some(streaming.clone())
                }
                (Some(_), Some(_)) => {
                    // Credentials left over from the previous account. Serving
                    // them would connect playback as the wrong user.
                    s.streaming = None;
                    None
                }
                _ => None,
            };
            (current_account, matching)
        };
        let Some(current_account) = current_account else {
            return Err(AuthError::StreamingLoginRequired);
        };
        let stored = match stored {
            Some(token) => Some(token),
            None => storage::load_streaming_session_for(&current_account).await?,
        };
        match stored {
            Some(st) if !force_refresh && st.expires_at > now_ms() + 30_000 => {
                return Ok((st.access_token, st.expires_at));
            }
            Some(st) if !st.refresh_token.trim().is_empty() => {
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
                let status = resp.status();
                if status.is_success() {
                    let parsed = resp
                        .json::<TokenResponse>()
                        .await
                        .map_err(|error| AuthError::Http(error.to_string()))?;
                    let new_at = AccessToken {
                        access_token: parsed.access_token.clone(),
                        refresh_token: parsed.refresh_token.unwrap_or(st.refresh_token),
                        expires_at: now_ms() + parsed.expires_in * 1000,
                        account_id: st.account_id,
                        scopes: st.scopes,
                        client_id: KEYMASTER_CLIENT_ID.to_string(),
                    };
                    let mut state = self.state.lock().await;
                    // Sign-out or an account switch may have happened while
                    // the refresh was on the wire. Committing then would
                    // resurrect stale playback credentials.
                    let still_current = self.session_epoch() == epoch
                        && state
                            .current
                            .as_ref()
                            .is_some_and(|token| token.account_id == new_at.account_id);
                    if !still_current {
                        return Err(AuthError::StreamingLoginRequired);
                    }
                    state.streaming = Some(new_at.clone());
                    drop(state);
                    let persisted = storage::save_streaming_session(&new_at).await.is_ok();
                    let mut state = self.state.lock().await;
                    state.storage = if persisted {
                        super::types::Storage::Keyring
                    } else {
                        super::types::Storage::Memory
                    };
                    return Ok((new_at.access_token, new_at.expires_at));
                }
                if status.is_client_error() {
                    self.clear_revoked_streaming_session().await;
                    return Err(AuthError::StreamingLoginRequired);
                }
                return Err(AuthError::Http(
                    "streaming token refresh failed".to_string(),
                ));
            }
            _ => {}
        }
        Err(AuthError::StreamingLoginRequired)
    }

    pub(super) async fn clear_revoked_streaming_session(&self) {
        let account_id = self
            .state
            .lock()
            .await
            .streaming
            .take()
            .map(|token| token.account_id);
        storage::delete_streaming_session(account_id.as_deref()).await;
        self.emit(
            "auth.failed",
            serde_json::json!({
                "reason": "token_exchange",
                "message": "Streaming authorization expired. Authenticate streaming again.",
            }),
        )
        .await;
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
