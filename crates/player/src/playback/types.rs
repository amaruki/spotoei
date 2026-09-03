use std::time::Instant;

use serde::{Deserialize, Serialize};

/// Authoritative UI-facing playback state. Stable, compact, additive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackState {
    Idle,
    Loading,
    Buffering,
    Playing,
    Paused,
    Reconnecting,
    Error,
}

impl PlaybackState {
    pub fn as_str(self) -> &'static str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Loading => "loading",
            PlaybackState::Buffering => "buffering",
            PlaybackState::Playing => "playing",
            PlaybackState::Paused => "paused",
            PlaybackState::Reconnecting => "reconnecting",
            PlaybackState::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    Context,
    Track,
}

impl RepeatMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::Context => "context",
            RepeatMode::Track => "track",
        }
    }

    pub fn from_str(s: &str) -> Option<RepeatMode> {
        match s {
            "off" => Some(RepeatMode::Off),
            "context" => Some(RepeatMode::Context),
            "track" => Some(RepeatMode::Track),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(rename = "observedAtMonotonicMs")]
    pub observed_at_monotonic_ms: u64,
}
