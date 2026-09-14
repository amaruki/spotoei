use std::time::Instant;

use serde::{Deserialize, Serialize};

mod config;
#[cfg(test)]
mod tests;
mod values;

pub use config::LibrespotConfig;
pub use values::{AudioBackend, Bitrate, DeviceMode, PlaybackState, RepeatMode};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Track {
    pub uri: String,
    pub name: String,
    pub artists: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(rename = "imageUrl", default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlaybackInner {
    pub revision: u64,
    pub state: PlaybackState,
    pub track: Option<Track>,
    pub context_uri: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub autoplay: bool,
    pub last_change_at: Instant,
    pub last_emitted_position_ms: u64,
    pub muted_volume: Option<f32>,
    pub device_mode: DeviceMode,
    pub audio_backend: AudioBackend,
    pub bitrate: Bitrate,
    pub crossfade_duration_ms: u32,
    pub normalisation: bool,
    pub normalisation_type: String,
    pub pregain: f32,
}

impl PlaybackInner {
    pub fn new() -> Self {
        Self {
            revision: 0,
            state: PlaybackState::Idle,
            track: None,
            context_uri: None,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
            autoplay: true,
            last_change_at: Instant::now(),
            last_emitted_position_ms: 0,
            muted_volume: None,
            device_mode: DeviceMode::Integrated,
            audio_backend: AudioBackend::Rodio,
            bitrate: Bitrate::Bitrate320,
            crossfade_duration_ms: 0,
            normalisation: true,
            normalisation_type: "album".to_string(),
            pregain: 0.0,
        }
    }
}

impl Default for PlaybackInner {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlaybackError;

/// Input for `Playback::load`. Bundled into a struct so the call site does
/// not have to remember positional argument order, and so clippy does not
/// flag the function for exceeding the 7-argument heuristic.
#[derive(Debug, Default, Clone)]
pub struct LoadRequest<'a> {
    pub context_uri: Option<&'a str>,
    pub track_uri: Option<&'a str>,
    /// Upcoming queue for the Connect context (current track first). Owned
    /// because it crosses from the IPC dispatcher into the async engine.
    pub queue_uris: Option<Vec<String>>,
    pub name: Option<&'a str>,
    pub artists: Option<Vec<String>>,
    pub album: Option<&'a str>,
    pub duration_ms: Option<u64>,
    pub genre: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackChangedPayload {
    pub revision: u64,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<Track>,
    #[serde(rename = "positionMs")]
    pub position_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: String,
    pub autoplay: bool,
    #[serde(rename = "deviceMode", skip_serializing_if = "Option::is_none")]
    pub device_mode: Option<String>,
    #[serde(rename = "observedAtMonotonicMs")]
    pub observed_at_monotonic_ms: u64,
}
