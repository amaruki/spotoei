use serde_json::Value;

use crate::lyrics::{LyricsError, LyricsService};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub fn get(cmd: &Command, lyrics: &LyricsService) -> String {
    let track_uri = cmd
        .data
        .get("trackUri")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match lyrics.get(track_uri) {
        Ok(doc) => ok(&cmd.id, serde_json::to_value(&doc).unwrap_or(Value::Null)),
        Err(LyricsError::Unavailable) => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::LyricsUnavailable,
                "lyrics unavailable for this track",
            ),
        ),
        Err(LyricsError::InvalidUri) => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "invalid track URI"),
        ),
    }
}
