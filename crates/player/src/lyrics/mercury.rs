use super::{LyricsDocument, LyricsError, PlainLyricLine, TimedLyricLine};

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
