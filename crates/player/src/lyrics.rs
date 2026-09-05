// Lyrics domain model and provider adapters.
//
// Clean Architecture: Audio playback is decoupled from lyrics retrieval.
// A failure or delay in fetching lyrics must never block or stutter playback.

use serde::Serialize;
use std::sync::Arc;

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

/// Hybrid provider using Librespot Mercury to fetch live lyrics,
/// falling back to `MockLyricsProvider` if Mercury fails or session is absent.
pub struct LibrespotLyricsProvider {
    engine: Arc<crate::playback::LibrespotEngine>,
    mock_fallback: MockLyricsProvider,
}

impl LibrespotLyricsProvider {
    pub fn new(engine: Arc<crate::playback::LibrespotEngine>) -> Self {
        Self {
            engine,
            mock_fallback: MockLyricsProvider::new(),
        }
    }
}

impl LyricsProvider for LibrespotLyricsProvider {
    fn get_lyrics(&self, track_uri: &str) -> Result<LyricsDocument, LyricsError> {
        if !track_uri.starts_with("spotify:track:") {
            return Err(LyricsError::InvalidUri);
        }

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let engine = self.engine.clone();
            let uri = track_uri.to_string();
            let fetch_fut = async move {
                tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    engine.fetch_mercury_lyrics(&uri),
                )
                .await
            };
            let res = match handle.runtime_flavor() {
                tokio::runtime::RuntimeFlavor::MultiThread => {
                    tokio::task::block_in_place(|| {
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handle.block_on(fetch_fut).ok().and_then(|r| r.ok())
                        }))
                        .ok()
                        .flatten()
                    })
                }
                _ => {
                    std::thread::spawn(move || {
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            let rt = tokio::runtime::Builder::new_current_thread()
                                .enable_all()
                                .build()
                                .ok()?;
                            rt.block_on(fetch_fut).ok().and_then(|r| r.ok())
                        }))
                        .ok()
                        .flatten()
                    })
                    .join()
                    .ok()
                    .flatten()
                }
            };

            if let Some(doc) = res {
                return Ok(doc);
            }
        }

        self.mock_fallback.get_lyrics(track_uri)
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

#[derive(Debug, serde::Deserialize)]
struct RawMercuryLyricsResponse {
    #[serde(default)]
    lyrics: Option<RawLyricsContent>,
    #[serde(default)]
    lines: Option<Vec<RawMercuryLine>>,
    #[serde(default, rename = "syncType")]
    sync_type: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct RawLyricsContent {
    #[serde(default)]
    lines: Vec<RawMercuryLine>,
    #[serde(default, rename = "syncType")]
    sync_type: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct RawMercuryLine {
    #[serde(default, rename = "startTimeMs")]
    start_time_ms: Option<serde_json::Value>,
    #[serde(default)]
    words: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

/// Parse raw bytes returned by Spotify Mercury or spclient lyrics endpoint.
pub fn parse_mercury_lyrics_payload(bytes: &[u8]) -> Result<LyricsDocument, LyricsError> {
    if std::str::from_utf8(bytes).is_err() {
        return Err(LyricsError::Unavailable);
    }

    let raw: RawMercuryLyricsResponse =
        serde_json::from_slice(bytes).map_err(|_| LyricsError::Unavailable)?;
    let (lines, sync_type, language) = if let Some(body) = raw.lyrics {
        (
            body.lines,
            body.sync_type.or(raw.sync_type),
            body.language.or(raw.language),
        )
    } else if let Some(lines) = raw.lines {
        (lines, raw.sync_type, raw.language)
    } else {
        return Err(LyricsError::Unavailable);
    };

    if lines.is_empty() {
        return Err(LyricsError::Unavailable);
    }

    let is_synced = sync_type
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("LINE_SYNCED"))
        .unwrap_or(true);

    if is_synced {
        let mut timed_lines = Vec::with_capacity(lines.len());
        for l in lines {
            let text = l.words.or(l.text).unwrap_or_default();
            let start_ms = match l.start_time_ms {
                Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
                Some(serde_json::Value::String(s)) => s.parse::<u64>().unwrap_or(0),
                _ => 0,
            };
            timed_lines.push(TimedLyricLine { start_ms, text });
        }
        Ok(LyricsDocument::Synced {
            language,
            lines: timed_lines,
        })
    } else {
        let mut plain_lines = Vec::with_capacity(lines.len());
        for l in lines {
            let text = l.words.or(l.text).unwrap_or_default();
            plain_lines.push(PlainLyricLine { text });
        }
        Ok(LyricsDocument::Plain {
            language,
            lines: plain_lines,
        })
    }
}

/// Fetch lyrics from Spotify Mercury endpoint `hm://lyrics/v1/track/{track_id}`.
pub async fn fetch_mercury_lyrics(
    session: &librespot::core::session::Session,
    track_uri_or_id: &str,
) -> Result<LyricsDocument, LyricsError> {
    let track_id = if let Some(stripped) = track_uri_or_id.strip_prefix("spotify:track:") {
        stripped
    } else {
        track_uri_or_id
    };

    if track_id.is_empty() {
        return Err(LyricsError::InvalidUri);
    }

    let url = format!("hm://lyrics/v1/track/{}", track_id);
    let mercury_fut = session
        .mercury()
        .get(url)
        .map_err(|_| LyricsError::Unavailable)?;

    let response = tokio::time::timeout(std::time::Duration::from_secs(3), mercury_fut)
        .await
        .map_err(|_| LyricsError::Unavailable)?
        .map_err(|_| LyricsError::Unavailable)?;
    if response.status_code != 200 || response.payload.is_empty() {
        return Err(LyricsError::Unavailable);
    }

    let payload = &response.payload[0];
    if std::str::from_utf8(payload).is_err() {
        return Err(LyricsError::Unavailable);
    }

    parse_mercury_lyrics_payload(payload)
}
/// Fetch lyrics using Mercury endpoint with fallback to spclient color-lyrics.
pub async fn fetch_session_lyrics(
    session: &librespot::core::session::Session,
    track_uri_or_id: &str,
) -> Result<LyricsDocument, LyricsError> {
    if let Ok(doc) = fetch_mercury_lyrics(session, track_uri_or_id).await {
        return Ok(doc);
    }

    let track_id_str = track_uri_or_id.trim_start_matches("spotify:track:");
    if let Ok(sp_id) = librespot::core::spotify_id::SpotifyId::from_base62(track_id_str) {
        if let Ok(lyrics) = librespot::metadata::Lyrics::get(session, &sp_id).await {
            let is_synced = matches!(
                lyrics.lyrics.sync_type,
                librespot::metadata::lyrics::SyncType::LineSynced
            );
            if is_synced {
                let lines = lyrics
                    .lyrics
                    .lines
                    .into_iter()
                    .map(|l| TimedLyricLine {
                        start_ms: l.start_time_ms.parse::<u64>().unwrap_or(0),
                        text: l.words,
                    })
                    .collect();
                return Ok(LyricsDocument::Synced {
                    language: Some(lyrics.lyrics.language),
                    lines,
                });
            }
            let lines = lyrics
                .lyrics
                .lines
                .into_iter()
                .map(|l| PlainLyricLine { text: l.words })
                .collect();
            return Ok(LyricsDocument::Plain {
                language: Some(lyrics.lyrics.language),
                lines,
            });
        }
    }

    Err(LyricsError::Unavailable)
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

    #[test]
    fn test_parse_mercury_lyrics_payload_synced() {
        let json = r#"{
            "lyrics": {
                "syncType": "LINE_SYNCED",
                "language": "en",
                "lines": [
                    { "startTimeMs": "1000", "words": "Line one" },
                    { "startTimeMs": "3500", "words": "Line two" }
                ]
            }
        }"#;
        let doc = parse_mercury_lyrics_payload(json.as_bytes()).unwrap();
        match doc {
            LyricsDocument::Synced { language, lines } => {
                assert_eq!(language.as_deref(), Some("en"));
                assert_eq!(lines.len(), 2);
                assert_eq!(lines[0].start_ms, 1000);
                assert_eq!(lines[0].text, "Line one");
                assert_eq!(lines[1].start_ms, 3500);
                assert_eq!(lines[1].text, "Line two");
            }
            _ => panic!("expected synced lyrics"),
        }
    }

    #[test]
    fn test_parse_mercury_lyrics_payload_plain() {
        let json = r#"{
            "syncType": "UNSYNCED",
            "language": "en",
            "lines": [
                { "text": "Line one" },
                { "text": "Line two" }
            ]
        }"#;
        let doc = parse_mercury_lyrics_payload(json.as_bytes()).unwrap();
        match doc {
            LyricsDocument::Plain { lines, .. } => {
                assert_eq!(lines.len(), 2);
                assert_eq!(lines[0].text, "Line one");
                assert_eq!(lines[1].text, "Line two");
            }
            _ => panic!("expected plain lyrics"),
        }
    }

    #[tokio::test]
    async fn test_librespot_lyrics_fallback_to_mock() {
        let (stdout_tx, _stdout_rx) = tokio::sync::mpsc::channel(1);
        let auth = Arc::new(crate::auth::AuthManager::new("test_client".to_string(), stdout_tx));
        let engine = Arc::new(crate::playback::LibrespotEngine::new(auth));
        let provider = LibrespotLyricsProvider::new(engine);

        // Without active Spotify session, it safely falls back to MockLyricsProvider
        let doc = provider.get_lyrics("spotify:track:test1234").unwrap();
        match doc {
            LyricsDocument::Synced { lines, .. } => {
                assert_eq!(lines.len(), 4);
            }
            _ => panic!("expected synced lyrics from fallback"),
        }

        // Invalid URI returns InvalidUri
        let err = provider.get_lyrics("bad:uri").unwrap_err();
        assert_eq!(err, LyricsError::InvalidUri);
    }

    #[test]
    fn test_parse_mercury_lyrics_payload_invalid_utf8() {
        let invalid_utf8 = [0xFF, 0xFE, 0xFD];
        let res = parse_mercury_lyrics_payload(&invalid_utf8);
        assert_eq!(res, Err(LyricsError::Unavailable));
    }
}
