use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

mod commands;
pub mod connect_load;
mod fetch;
pub mod reauth;
mod session;
mod settings;
mod sink;

pub use session::LibrespotActive;
pub use sink::{DummySink, VisualizerSink};
/// Real audio playback engine driven by Librespot and native Rodio audio sink.
#[derive(Clone)]
pub struct LibrespotEngine {
    pub(super) auth: Arc<crate::auth::AuthManager>,
    pub(super) inner: Arc<Mutex<Option<session::LibrespotActive>>>,
    pub(super) track_metadata_cache: Arc<Mutex<HashMap<String, super::types::Track>>>,
    pub(super) pcm_sender: crossbeam_channel::Sender<Vec<f32>>,
    pub(super) pcm_receiver: crossbeam_channel::Receiver<Vec<f32>>,
    pub(super) config: Arc<Mutex<super::types::LibrespotConfig>>,
    pub(super) last_audio_error: Arc<Mutex<Option<String>>>,
    pub(super) state_listener:
        Arc<std::sync::Mutex<Option<Arc<dyn super::engine::PlaybackStateListener>>>>,
    pub(super) unavailable: Arc<std::sync::Mutex<reauth::UnavailableTracker>>,
    pub(super) is_stopped: Arc<std::sync::atomic::AtomicBool>,
    /// When the last load request was issued, for end-to-end latency logs.
    pub(super) load_started_at: Arc<std::sync::Mutex<Option<std::time::Instant>>>,
    /// Serializes `connect_active` so a prewarm and a play request never
    /// build two Spotify sessions for the same device concurrently.
    pub(super) connect_guard: Arc<Mutex<()>>,
}

impl LibrespotEngine {
    pub fn new(auth: Arc<crate::auth::AuthManager>) -> Self {
        let engine = Self::with_config(auth, super::types::LibrespotConfig::resolve());
        let engine_clone = engine.clone();
        tokio::spawn(async move {
            let _ = engine_clone.ensure_active().await;
        });
        engine
    }

    pub fn with_config(
        auth: Arc<crate::auth::AuthManager>,
        config: super::types::LibrespotConfig,
    ) -> Self {
        let (pcm_sender, pcm_receiver) = crossbeam_channel::bounded(64);
        Self {
            auth,
            inner: Arc::new(Mutex::new(None)),
            track_metadata_cache: Arc::new(Mutex::new(HashMap::new())),
            pcm_sender,
            pcm_receiver,
            config: Arc::new(Mutex::new(config)),
            last_audio_error: Arc::new(Mutex::new(None)),
            state_listener: Arc::new(std::sync::Mutex::new(None)),
            unavailable: Arc::new(std::sync::Mutex::new(reauth::UnavailableTracker::default())),
            is_stopped: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            load_started_at: Arc::new(std::sync::Mutex::new(None)),
            connect_guard: Arc::new(Mutex::new(())),
        }
    }

    pub fn pcm_receiver(&self) -> crossbeam_channel::Receiver<Vec<f32>> {
        self.pcm_receiver.clone()
    }

    /// Throw the cached access token away and reconnect from scratch. Used
    /// when Spotify rejects the token on the playback services while the
    /// Web API still accepts it; without this the player would skip every
    /// track forever on a token only the audio path dislikes.
    pub async fn reconnect_with_fresh_token(&self) {
        crate::auth::storage::delete_librespot_credentials_cache();
        self.auth.invalidate_token().await;
        *self.inner.lock().await = None;
        if let Err(e) = self.ensure_active().await {
            tracing::warn!("reconnect with fresh token failed: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::session::resolve_sink_with_fallback;
    use super::*;
    use crate::auth::AuthManager;
    use crate::playback::types::{AudioBackend, DeviceMode, LibrespotConfig};
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_librespot_engine_modes_and_backends() {
        let (tx, _rx) = mpsc::channel(8);
        let auth = Arc::new(AuthManager::new("test_client".to_string(), tx));
        let config = LibrespotConfig {
            device_mode: DeviceMode::ConnectOnly,
            audio_backend: AudioBackend::Dummy,
            device_name: "TestConnect".to_string(),
            audio_device: None,
            gapless: false,
            normalisation: false,
            ..Default::default()
        };
        let engine = LibrespotEngine::with_config(auth, config);

        assert_eq!(engine.device_mode().await, DeviceMode::ConnectOnly);
        assert_eq!(engine.audio_backend().await, AudioBackend::Dummy);

        engine.set_device_mode(DeviceMode::Integrated).await;
        assert_eq!(engine.device_mode().await, DeviceMode::Integrated);

        engine.set_audio_backend(AudioBackend::Alsa).await;
        assert_eq!(engine.audio_backend().await, AudioBackend::Alsa);

        let cfg = engine.config().await;
        assert_eq!(cfg.device_mode, DeviceMode::Integrated);
        assert_eq!(cfg.audio_backend, AudioBackend::Alsa);
        assert_eq!(cfg.device_name, "TestConnect");
        assert!(!cfg.gapless);
        engine
            .set_bitrate(crate::playback::types::Bitrate::Bitrate160)
            .await;
        assert_eq!(
            engine.bitrate().await,
            crate::playback::types::Bitrate::Bitrate160
        );
        engine.set_crossfade_duration_ms(5000).await;
        assert_eq!(engine.crossfade_duration_ms().await, 5000);
        engine.set_normalisation(false).await;
        assert!(!engine.normalisation().await);
        engine.set_normalisation_type("track").await;
        assert_eq!(engine.normalisation_type().await, "track");
        engine.set_pregain(3.0).await;
        assert_eq!(engine.pregain().await, 3.0);
    }

    #[test]
    fn test_resolve_sink_with_fallback_dummy() {
        let (sink_fn, backend, err) = resolve_sink_with_fallback(AudioBackend::Dummy, None);
        assert_eq!(backend, AudioBackend::Dummy);
        assert!(err.is_none());
        let mut sink = sink_fn();
        assert!(sink.start().is_ok());
        assert!(sink.stop().is_ok());
    }

    #[tokio::test]
    async fn test_librespot_engine_audio_settings_clamping() {
        let (tx, _rx) = mpsc::channel(8);
        let auth = Arc::new(AuthManager::new("test_client".to_string(), tx));
        let engine = LibrespotEngine::new(auth);

        engine.set_crossfade_duration_ms(25000).await;
        assert_eq!(engine.crossfade_duration_ms().await, 15000);

        engine.set_pregain(-30.0).await;
        assert_eq!(engine.pregain().await, -20.0);
        engine.set_pregain(40.0).await;
        assert_eq!(engine.pregain().await, 20.0);
        engine.set_pregain(f32::NAN).await;
        assert_eq!(engine.pregain().await, 0.0);

        engine.set_normalisation_type("invalid").await;
        assert_eq!(engine.normalisation_type().await, "album");
        engine.set_normalisation_type("TRACK").await;
        assert_eq!(engine.normalisation_type().await, "track");
    }
}
