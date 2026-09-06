use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

mod commands;
mod session;
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
    pub(super) state_listener: Arc<std::sync::Mutex<Option<Arc<dyn super::engine::PlaybackStateListener>>>>,
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
        }
    }

    pub fn pcm_receiver(&self) -> crossbeam_channel::Receiver<Vec<f32>> {
        self.pcm_receiver.clone()
    }

    pub async fn config(&self) -> super::types::LibrespotConfig {
        self.config.lock().await.clone()
    }

    pub async fn device_mode(&self) -> super::types::DeviceMode {
        self.config.lock().await.device_mode
    }

    pub async fn set_device_mode(&self, mode: super::types::DeviceMode) {
        let mut cfg = self.config.lock().await;
        cfg.device_mode = mode;
    }

    pub async fn audio_backend(&self) -> super::types::AudioBackend {
        self.config.lock().await.audio_backend
    }

    pub async fn set_audio_backend(&self, backend: super::types::AudioBackend) {
        let mut cfg = self.config.lock().await;
        cfg.audio_backend = backend;
    }

    pub async fn bitrate(&self) -> super::types::Bitrate {
        self.config.lock().await.bitrate
    }

    pub async fn set_bitrate(&self, bitrate: super::types::Bitrate) {
        let mut cfg = self.config.lock().await;
        cfg.bitrate = bitrate;
    }

    pub async fn crossfade_duration_ms(&self) -> u32 {
        self.config.lock().await.crossfade_duration_ms
    }

    pub async fn set_crossfade_duration_ms(&self, duration_ms: u32) {
        let mut cfg = self.config.lock().await;
        cfg.crossfade_duration_ms = duration_ms.clamp(0, 15_000);
    }

    pub async fn normalisation(&self) -> bool {
        self.config.lock().await.normalisation
    }

    pub async fn set_normalisation(&self, enabled: bool) {
        let mut cfg = self.config.lock().await;
        cfg.normalisation = enabled;
    }

    pub async fn normalisation_type(&self) -> String {
        self.config.lock().await.normalisation_type.clone()
    }

    pub async fn set_normalisation_type(&self, norm_type: &str) {
        let mut cfg = self.config.lock().await;
        cfg.normalisation_type = match norm_type.trim().to_ascii_lowercase().as_str() {
            "track" => "track".to_string(),
            _ => "album".to_string(),
        };
    }

    pub async fn pregain(&self) -> f32 {
        self.config.lock().await.pregain
    }

    pub async fn set_pregain(&self, pregain: f32) {
        let mut cfg = self.config.lock().await;
        cfg.pregain = if pregain.is_nan() {
            0.0
        } else {
            pregain.clamp(-20.0, 20.0)
        };
    }
    pub async fn last_audio_error(&self) -> Option<String> {
        self.last_audio_error.lock().await.clone()
    }

    /// Fetch track metadata using `librespot::metadata::Track::get` with active session
    pub async fn fetch_metadata(
        &self,
        id: &librespot::core::spotify_uri::SpotifyUri,
    ) -> Result<super::types::Track, String> {
        let act = self.ensure_active().await?;
        let session = &act.session;
        use librespot::metadata::Metadata;
        let track = librespot::metadata::Track::get(session, id)
            .await
            .map_err(|e| format!("Failed to fetch track metadata: {:?}", e))?;
        let uri = track
            .id
            .to_uri()
            .unwrap_or_else(|_| format!("spotify:track:{}", track.id));
        let artists = track.artists.iter().map(|a| a.name.clone()).collect();
        let album = Some(track.album.name.clone());
        let t = super::types::Track {
            uri,
            name: track.name.clone(),
            artists,
            album,
            duration_ms: track.duration.max(0) as u64,
            genre: None,
            image_url: track
                .album
                .covers
                .first()
                .map(|img| format!("https://i.scdn.co/image/{}", img.id)),
        };
        if let Ok(mut cache) = self.track_metadata_cache.try_lock() {
            cache.insert(t.uri.clone(), t.clone());
        }
        Ok(t)
    }

    pub async fn fetch_track_metadata(&self, track_uri_or_id: &str) -> Result<super::types::Track, String> {
        let uri = if track_uri_or_id.starts_with("spotify:track:") {
            librespot::core::spotify_uri::SpotifyUri::from_uri(track_uri_or_id)
                .map_err(|e| format!("Invalid track URI: {:?}", e))?
        } else if track_uri_or_id.len() == 22 {
            let full_uri = format!("spotify:track:{}", track_uri_or_id);
            librespot::core::spotify_uri::SpotifyUri::from_uri(&full_uri)
                .map_err(|e| format!("Invalid track ID: {:?}", e))?
        } else {
            librespot::core::spotify_uri::SpotifyUri::from_uri(track_uri_or_id)
                .map_err(|e| format!("Invalid track specifier: {:?}", e))?
        };
        self.fetch_metadata(&uri).await
    }

    pub async fn fetch_lyrics(
        &self,
        track_uri_or_id: &str,
    ) -> Result<crate::lyrics::LyricsDocument, String> {
        let act = self.ensure_active().await?;
        crate::lyrics::fetch_session_lyrics(&act.session, track_uri_or_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn fetch_mercury_lyrics(
        &self,
        track_uri_or_id: &str,
    ) -> Result<crate::lyrics::LyricsDocument, String> {
        let act = self.ensure_active().await?;
        crate::lyrics::fetch_mercury_lyrics(&act.session, track_uri_or_id)
            .await
            .map_err(|e| e.to_string())
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
        engine.set_bitrate(crate::playback::types::Bitrate::Bitrate160).await;
        assert_eq!(engine.bitrate().await, crate::playback::types::Bitrate::Bitrate160);
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
