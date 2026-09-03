use super::types::{RepeatMode, Track};

/// Engine abstraction so the fake implementation can be swapped for the
/// real librespot-driven one in a future milestone.
pub trait PlaybackEngine: Send + Sync {
    fn resolve_track(&self, uri: &str) -> Option<Track>;
    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
    }
    fn play_track(&self, _uri: &str, _autoplay: bool, _position_ms: u32) {}
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
}

/// Deterministic fake engine used for headless tests and UI development
/// until the real librespot path lands.
#[derive(Debug, Default)]
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
            })
            .collect()
    }
}
