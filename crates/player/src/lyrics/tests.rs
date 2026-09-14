use super::*;
use std::sync::Arc;

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
    let auth = Arc::new(crate::auth::AuthManager::new(
        "test_client".to_string(),
        stdout_tx,
    ));
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
