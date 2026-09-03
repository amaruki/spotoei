// Lyrics domain model and provider adapters.
//
// Clean Architecture: Audio playback is decoupled from lyrics retrieval.
// A failure or delay in fetching lyrics must never block or stutter playback.

use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
pub struct TimedLyricLine {
    #[serde(rename = "startMs")]
    pub start_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlainLyricLine {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
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

// Mock provider: returns deterministic synced/plain lyrics for well-known test tracks,
// or generates fallback plain lines for any valid URI.
#[derive(Debug, Default)]
pub struct MockLyricsProvider;

impl MockLyricsProvider {
    pub fn new() -> Self {
        Self
    }
}

impl LyricsProvider for MockLyricsProvider {
    fn get_lyrics(&self, track_uri: &str) -> Result<LyricsDocument, LyricsError> {
        if !track_uri.starts_with("spotify:track:") {
            return Err(LyricsError::InvalidUri);
        }

        if track_uri.ends_with("unavailable") {
            return Err(LyricsError::Unavailable);
        }

        if track_uri.ends_with("plain") {
            return Ok(LyricsDocument::Plain {
                language: Some("en".to_string()),
                lines: vec![
                    PlainLyricLine {
                        text: "This is line one of the plain lyrics.".to_string(),
                    },
                    PlainLyricLine {
                        text: "This is line two with no timestamp sync.".to_string(),
                    },
                    PlainLyricLine {
                        text: "Unsynced lyrics scroll manually in the TUI.".to_string(),
                    },
                ],
            });
        }

        // Default mock: synced lyrics with progressive timestamps
        Ok(LyricsDocument::Synced {
            language: Some("en".to_string()),
            lines: vec![
                TimedLyricLine {
                    start_ms: 0,
                    text: "First lyric line (intro)".to_string(),
                },
                TimedLyricLine {
                    start_ms: 3000,
                    text: "Second lyric line (verse)".to_string(),
                },
                TimedLyricLine {
                    start_ms: 6000,
                    text: "Third lyric line (chorus)".to_string(),
                },
                TimedLyricLine {
                    start_ms: 9000,
                    text: "Fourth lyric line (outro)".to_string(),
                },
            ],
        })
    }
}

#[derive(Clone)]
pub struct LyricsService {
    provider: Arc<dyn LyricsProvider>,
}

impl LyricsService {
    pub fn new(provider: Arc<dyn LyricsProvider>) -> Self {
        Self { provider }
    }

    pub fn get(&self, track_uri: &str) -> Result<LyricsDocument, LyricsError> {
        self.provider.get_lyrics(track_uri)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_lyrics_synced_default() {
        let provider = MockLyricsProvider::new();
        let result = provider.get_lyrics("spotify:track:test1234").unwrap();
        match result {
            LyricsDocument::Synced { lines, .. } => {
                assert_eq!(lines.len(), 4);
                assert_eq!(lines[0].start_ms, 0);
                assert_eq!(lines[1].start_ms, 3000);
            }
            _ => panic!("expected synced lyrics"),
        }
    }

    #[test]
    fn test_mock_lyrics_plain() {
        let provider = MockLyricsProvider::new();
        let result = provider.get_lyrics("spotify:track:test_plain").unwrap();
        match result {
            LyricsDocument::Plain { lines, .. } => {
                assert_eq!(lines.len(), 3);
            }
            _ => panic!("expected plain lyrics"),
        }
    }

    #[test]
    fn test_mock_lyrics_unavailable() {
        let provider = MockLyricsProvider::new();
        let err = provider
            .get_lyrics("spotify:track:test_unavailable")
            .unwrap_err();
        assert_eq!(err, LyricsError::Unavailable);
    }

    #[test]
    fn test_mock_lyrics_invalid_uri() {
        let provider = MockLyricsProvider::new();
        let err = provider.get_lyrics("invalid:uri").unwrap_err();
        assert_eq!(err, LyricsError::InvalidUri);
    }
}
