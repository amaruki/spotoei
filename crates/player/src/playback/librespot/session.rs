use std::future::Future;
use std::sync::Arc;

mod audio;
mod connect;
mod events;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub use audio::resolve_sink;
pub use audio::resolve_sink_with_fallback;
pub use events::monitor_player_events;

#[derive(Clone)]
pub struct LibrespotActive {
    pub session: librespot::core::session::Session,
    pub player: Arc<librespot::playback::player::Player>,
    pub spirc: Option<Arc<librespot::connect::Spirc>>,
    pub device_id: String,
    pub active_device_mode: super::super::types::DeviceMode,
    pub active_audio_backend: super::super::types::AudioBackend,
    /// Auth generation this session was created for. When the auth identity
    /// changes (logout, new login, client ID reset) the cached session is
    /// dropped instead of resuming the previous user.
    pub created_epoch: u64,
}

/// How a session-connect attempt ended.
enum ConnectError {
    /// Spotify rejected the token on the playback services; retrying once
    /// with a fresh token may recover.
    Credentials,
    /// The auth identity changed (sign-out, new login, client ID reset) while
    /// the session was connecting. The half-built session belongs to a user
    /// nobody wants any more and must not be installed.
    Superseded,
    /// Anything else, with the message for the caller.
    Fatal(String),
}

impl ConnectError {
    fn message(self) -> String {
        match self {
            ConnectError::Credentials => "Spotify rejected the playback credentials".to_string(),
            ConnectError::Superseded => "authentication changed while connecting".to_string(),
            ConnectError::Fatal(message) => message,
        }
    }
}

pub type SinkFn =
    Box<dyn Fn() -> Box<dyn librespot::playback::audio_backend::Sink> + Send + 'static>;

/// Client ID presented to Spotify for the playback connection. Dual-client
/// design: the streaming token is always minted for the official Keymaster
/// client (dedicated Step 2/2 login), so the session always presents
/// Keymaster too — regardless of which client the Web API token belongs to.
/// Presenting any other client makes login5 and audio reject the token with
/// `INVALID_CREDENTIALS` while the AP login and Web API accept it.
pub fn session_client_id() -> String {
    crate::auth::KEYMASTER_CLIENT_ID.to_string()
}

pub(super) async fn resolve_session_credentials<F, Fut, E>(
    cache: &librespot::core::cache::Cache,
    fetch_token: F,
) -> Result<(librespot::core::authentication::Credentials, bool), E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(String, u64), E>>,
{
    if let Some(cached) = cache.credentials() {
        return Ok((cached, true));
    }
    let (token, _) = fetch_token().await?;
    Ok((
        librespot::core::authentication::Credentials::with_access_token(token),
        false,
    ))
}

impl super::LibrespotEngine {
    pub async fn ensure_player(&self) -> Result<Arc<librespot::playback::player::Player>, String> {
        let act = self.ensure_active().await?;
        Ok(act.player)
    }

    pub(super) async fn ensure_active(&self) -> Result<LibrespotActive, String> {
        let wanted_epoch = self.auth.session_epoch();
        if let Some(act) = self.cached_active(wanted_epoch).await {
            return Ok(act);
        }

        // A prewarm may already be connecting. Serialize so this call waits
        // for that session instead of building a second one; re-check after
        // acquiring the guard in case it completed while we waited.
        let _guard = self.connect_guard.lock().await;
        let wanted_epoch = self.auth.session_epoch();
        if let Some(act) = self.cached_active(wanted_epoch).await {
            tracing::debug!("librespot session became ready while waiting for connect");
            return Ok(act);
        }

        // No auth session means no playback session: fail fast instead of
        // resurrecting the previous user from the librespot disk cache.
        if !self.auth.has_current_session().await {
            *self.inner.lock().await = None;
            return Err("Spotify authentication required".to_string());
        }

        match self.connect_active(wanted_epoch).await {
            Ok(act) => Ok(act),
            Err(ConnectError::Superseded) => {
                // Rebuild for whatever identity is current now. Doing this here
                // keeps a caller from surfacing a transient error just because
                // the user switched accounts mid-connect.
                if !self.auth.has_current_session().await {
                    *self.inner.lock().await = None;
                    return Err("Spotify authentication required".to_string());
                }
                let current_epoch = self.auth.session_epoch();
                self.connect_active(current_epoch)
                    .await
                    .map_err(|e| e.message())
            }
            Err(ConnectError::Credentials) => {
                tracing::warn!("playback credentials rejected; clearing credentials cache, refreshing token and retrying once");
                crate::auth::storage::delete_librespot_credentials_cache();
                self.auth.invalidate_token().await;
                self.connect_active(wanted_epoch)
                    .await
                    .map_err(|e| e.message())
            }
            Err(ConnectError::Fatal(message)) => Err(message),
        }
    }

    /// Return the installed session when it still matches the auth identity
    /// and is not invalid.
    async fn cached_active(&self, wanted_epoch: u64) -> Option<LibrespotActive> {
        let guard = self.inner.lock().await;
        if let Some(ref act) = *guard {
            if act.created_epoch == wanted_epoch && !act.session.is_invalid() {
                return Some(act.clone());
            }
        }
        None
    }
}
