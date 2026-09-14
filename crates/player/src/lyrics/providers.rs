use super::{LyricsDocument, LyricsError, LyricsProvider, PlainLyricLine, TimedLyricLine};
use std::sync::Arc;

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
                tokio::runtime::RuntimeFlavor::MultiThread => tokio::task::block_in_place(|| {
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        handle.block_on(fetch_fut).ok().and_then(|r| r.ok())
                    }))
                    .ok()
                    .flatten()
                }),
                _ => std::thread::spawn(move || {
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
                .flatten(),
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
