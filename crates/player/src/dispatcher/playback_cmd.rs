use serde_json::Value;

use crate::playback::{LoadRequest, Playback, PlaybackError};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub async fn dispatch(command: &str, cmd: &Command, playback: &Playback) -> String {
    match command {
        "playback.load" => load(cmd, playback).await,
        "playback.play" => match playback.play().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "no track loaded to play"),
            ),
        },
        "playback.pause" => match playback.pause().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "pause failed"),
            ),
        },
        "playback.toggle" => match playback.toggle().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "no track loaded to toggle"),
            ),
        },
        "playback.next" => match playback.next().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "next failed"),
            ),
        },
        "playback.previous" => match playback.previous().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "previous failed"),
            ),
        },
        "playback.seek" => seek(cmd, playback).await,
        "playback.set_volume" => set_volume(cmd, playback).await,
        "playback.set_shuffle" => set_shuffle(cmd, playback).await,
        "playback.set_repeat" => set_repeat(cmd, playback).await,
        "playback.set_autoplay" => set_autoplay(cmd, playback).await,
        _ => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::InvalidRequest,
                format!("unknown command: {command}"),
            ),
        ),
    }
}

async fn load(cmd: &Command, playback: &Playback) -> String {
    let context_uri = cmd.data.get("contextUri").and_then(|v| v.as_str());
    let track_uri = cmd.data.get("trackUri").and_then(|v| v.as_str());
    let autoplay = cmd
        .data
        .get("autoplay")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let name = cmd.data.get("name").and_then(|v| v.as_str());
    let artists = cmd.data.get("artists").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect::<Vec<String>>()
    });
    let album = cmd.data.get("album").and_then(|v| v.as_str());
    let duration_ms = cmd.data.get("durationMs").and_then(|v| v.as_u64());
    let genre = cmd.data.get("genre").and_then(|v| v.as_str());
    let _ = playback.set_autoplay(autoplay).await;
    match playback
        .load(LoadRequest {
            context_uri,
            track_uri,
            name,
            artists,
            album,
            duration_ms,
            genre,
        })
        .await
    {
        Ok(snap) => {
            let final_snap = if autoplay {
                match playback.play().await {
                    Ok(s) => s,
                    Err(_) => snap,
                }
            } else {
                match playback.pause().await {
                    Ok(s) => s,
                    Err(_) => snap,
                }
            };
            ok(
                &cmd.id,
                serde_json::to_value(&final_snap).unwrap_or(Value::Null),
            )
        }
        Err(PlaybackError) => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::PlaybackFailed, "failed to load track/context"),
        ),
    }
}

async fn seek(cmd: &Command, playback: &Playback) -> String {
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

async fn set_volume(cmd: &Command, playback: &Playback) -> String {
    let vol_result: Result<f32, ErrorBody> = match cmd.data.get("volume") {
        Some(v) => v.as_f64().map(|f| f as f32).ok_or_else(|| {
            ErrorBody::new(ErrorCode::InvalidRequest, "volume must be a float")
        }),
        None => Err(ErrorBody::new(
            ErrorCode::InvalidRequest,
            "missing required volume",
        )),
    };
    match vol_result {
        Ok(vol) => match playback.set_volume(vol).await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "volume must be between 0.0 and 1.0",
                ),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}

async fn set_shuffle(cmd: &Command, playback: &Playback) -> String {
    let shuffle_result: Result<bool, ErrorBody> = match cmd.data.get("shuffle") {
        Some(v) => v.as_bool().ok_or_else(|| {
            ErrorBody::new(ErrorCode::InvalidRequest, "shuffle must be a boolean")
        }),
        None => Err(ErrorBody::new(
            ErrorCode::InvalidRequest,
            "missing required shuffle",
        )),
    };
    match shuffle_result {
        Ok(shuffle) => match playback.set_shuffle(shuffle).await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "set_shuffle failed"),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}

async fn set_repeat(cmd: &Command, playback: &Playback) -> String {
    let repeat_result: Result<&str, ErrorBody> = match cmd.data.get("repeat") {
        Some(v) => v.as_str().ok_or_else(|| {
            ErrorBody::new(ErrorCode::InvalidRequest, "repeat must be a string")
        }),
        None => Err(ErrorBody::new(
            ErrorCode::InvalidRequest,
            "missing required repeat",
        )),
    };
    match repeat_result {
        Ok(repeat) => match playback.set_repeat(repeat).await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "repeat mode must be off|context|track",
                ),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}

async fn set_autoplay(cmd: &Command, playback: &Playback) -> String {
    let autoplay = match cmd.data.get("autoplay").and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => {
            return err(
                &cmd.id,
                ErrorBody::new(ErrorCode::InvalidRequest, "autoplay must be a boolean"),
            );
        }
    };
    match playback.set_autoplay(autoplay).await {
        Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
        Err(PlaybackError) => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::PlaybackFailed, "set_autoplay failed"),
        ),
    }
}
