use super::types::{AudioBackend, Bitrate, DeviceMode, RepeatMode, Track};
/// Engine abstraction so the fake implementation can be swapped for the
/// real librespot-driven one in a future milestone.
pub trait PlaybackEngine: Send + Sync {
    fn resolve_track(&self, uri: &str) -> Option<Track>;
    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
    }
    fn play_track(&self, _uri: &str, _autoplay: bool, _position_ms: u32) {}
    /// Play a track together with its upcoming queue so Connect receivers
    /// can broadcast and walk the same context. Defaults to plain playback
    /// for engines without Connect support.
    fn play_track_in_context(
        &self,
        uri: &str,
        _context_uri: Option<&str>,
        _queue_uris: &[String],
        autoplay: bool,
        position_ms: u32,
    ) {
        self.play_track(uri, autoplay, position_ms);
    }
    fn resume(&self) {}
    fn pause(&self) {}
    fn stop(&self) {}
    fn seek(&self, _position_ms: u32) {}
    fn set_volume(&self, _volume: f32) {}
    fn next(&self) {}
    fn previous(&self) {}
    fn set_shuffle(&self, _shuffle: bool) {}
    fn set_repeat(&self, _mode: RepeatMode) {}
    fn remember_track_metadata(&self, _track: &Track) {}
    fn device_mode(&self) -> DeviceMode {
        DeviceMode::Integrated
    }
    fn set_device_mode(&self, _mode: DeviceMode) {}
    fn audio_backend(&self) -> AudioBackend {
        AudioBackend::Rodio
    }
    fn set_audio_backend(&self, _backend: AudioBackend) {}
    fn bitrate(&self) -> Bitrate {
        Bitrate::Bitrate320
    }
    fn set_bitrate(&self, _bitrate: Bitrate) {}
    fn crossfade_duration_ms(&self) -> u32 {
        0
    }
    fn set_crossfade_duration_ms(&self, _duration_ms: u32) {}
    fn normalisation(&self) -> bool {
        true
    }
    fn set_normalisation(&self, _enabled: bool) {}
    fn normalisation_type(&self) -> String {
        "album".to_string()
    }
    fn set_normalisation_type(&self, _norm_type: &str) {}
    fn pregain(&self) -> f32 {
        0.0
    }
    fn set_pregain(&self, _pregain: f32) {}
    fn attach_state_listener(&self, _listener: std::sync::Arc<dyn PlaybackStateListener>) {}
    fn reconcile_player_event(&self, _event: &librespot::playback::player::PlayerEvent) {}
}

pub trait PlaybackStateListener: Send + Sync {
    fn on_player_event(&self, event: &librespot::playback::player::PlayerEvent);
}

/// Deterministic fake engine used for headless tests and UI development
/// until the real librespot path lands.
#[derive(Debug, Default, Clone, Copy)]
pub struct FakeEngine;
impl PlaybackEngine for FakeEngine {
    fn resolve_track(&self, uri: &str) -> Option<Track> {
        if !uri.starts_with("spotify:track:") {
            return None;
        }
        if uri.len() > 256 {
            return None;
        }
        let id = uri.trim_start_matches("spotify:track:");
        if id.is_empty() || id.len() > 64 {
            return None;
        }
        Some(Track {
            uri: uri.to_string(),
            name: format!("Track {id}"),
            artists: vec!["Test Artist".to_string()],
            album: Some("Test Album".to_string()),
            duration_ms: 240_000,
            genre: None,
            image_url: None,
        })
    }
    fn context_tracks(&self, context_uri: &str) -> Vec<Track> {
        if !context_uri.starts_with("spotify:") {
            return Vec::new();
        }
        (1..=3)
            .map(|i| Track {
                uri: format!("spotify:track:ctx-{}-{}", context_uri, i),
                name: format!("Context Track {i}"),
                artists: vec!["Test Artist".to_string()],
                album: Some("Test Album".to_string()),
                duration_ms: 180_000,
                genre: None,
                image_url: None,
            })
            .collect()
    }
}
