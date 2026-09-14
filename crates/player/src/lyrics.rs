// Lyrics domain model and provider adapters.
//
// Clean Architecture: Audio playback is decoupled from lyrics retrieval.
// A failure or delay in fetching lyrics must never block or stutter playback.

use serde::Serialize;

mod mercury;
mod providers;
#[cfg(test)]
mod tests;

pub use mercury::{fetch_mercury_lyrics, fetch_session_lyrics, parse_mercury_lyrics_payload};
pub use providers::{LibrespotLyricsProvider, LyricsService, MockLyricsProvider};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TimedLyricLine {
    #[serde(rename = "startMs")]
    pub start_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlainLyricLine {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum LyricsDocument {
    #[serde(rename = "synced")]
    Synced {
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        lines: Vec<TimedLyricLine>,
    },
    #[serde(rename = "plain")]
    Plain {
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        lines: Vec<PlainLyricLine>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LyricsError {
    Unavailable,
    InvalidUri,
}

impl std::fmt::Display for LyricsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable => write!(f, "lyrics unavailable for this track"),
            Self::InvalidUri => write!(f, "invalid track URI"),
        }
    }
}

impl std::error::Error for LyricsError {}

pub trait LyricsProvider: Send + Sync {
    fn get_lyrics(&self, track_uri: &str) -> Result<LyricsDocument, LyricsError>;
}
