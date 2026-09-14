use serde_json::Value;

use crate::playback::{LoadRequest, Playback, PlaybackError};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub(super) async fn load(cmd: &Command, playback: &Playback) -> String {
    let context_uri = cmd.data.get("contextUri").and_then(|v| v.as_str());
    let track_uri = cmd.data.get("trackUri").and_then(|v| v.as_str());
    let autoplay = cmd
        .data
        .get("autoplay")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let name = cmd.data.get("name").and_then(|v| v.as_str());
    let artists = cmd
        .data
        .get("artists")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<String>>()
        });
    let album = cmd.data.get("album").and_then(|v| v.as_str());
    let duration_ms = cmd.data.get("durationMs").and_then(|v| v.as_u64());
    let genre = cmd.data.get("genre").and_then(|v| v.as_str());
    let queue_uris = cmd
        .data
        .get("queueUris")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .take(500)
                .collect::<Vec<String>>()
        });
    let _ = playback.set_autoplay(autoplay).await;
    match playback
        .load_opts(
            LoadRequest {
                context_uri,
                track_uri,
                queue_uris,
                name,
                artists,
                album,
                duration_ms,
                genre,
            },
            autoplay,
        )
        .await
    {
        Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
        Err(PlaybackError) => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::PlaybackFailed, "failed to load track/context"),
        ),
    }
}

pub(super) async fn seek(cmd: &Command, playback: &Playback) -> String {
    let pos_result: Result<u64, ErrorBody> = match cmd.data.get("positionMs") {
        Some(v) => v.as_u64().ok_or_else(|| {
            ErrorBody::new(ErrorCode::InvalidRequest, "positionMs must be an integer")
        }),
        None => Err(ErrorBody::new(
            ErrorCode::InvalidRequest,
            "missing required positionMs",
        )),
    };
    match pos_result {
        Ok(pos) => match playback.seek(pos).await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "seek failed; no track loaded"),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}

pub(super) async fn seek_relative(cmd: &Command, playback: &Playback) -> String {
    let offset_val = cmd
        .data
        .get("offsetMs")
        .or_else(|| cmd.data.get("offset_ms"));
    let offset_result: Result<i64, ErrorBody> = match offset_val {
        Some(v) => v.as_i64().ok_or_else(|| {
            ErrorBody::new(ErrorCode::InvalidRequest, "offsetMs must be an integer")
        }),
        None => Err(ErrorBody::new(
            ErrorCode::InvalidRequest,
            "missing required offsetMs",
        )),
    };
    match offset_result {
        Ok(offset) => match playback.seek_relative(offset).await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::PlaybackFailed,
                    "seek_relative failed; no track loaded",
                ),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}
