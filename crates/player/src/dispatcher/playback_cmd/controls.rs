use serde_json::Value;

use crate::playback::{Playback, PlaybackError};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub(super) async fn set_volume(cmd: &Command, playback: &Playback) -> String {
    let vol_result: Result<f32, ErrorBody> = match cmd.data.get("volume") {
        Some(v) => v
            .as_f64()
            .map(|f| f as f32)
            .ok_or_else(|| ErrorBody::new(ErrorCode::InvalidRequest, "volume must be a float")),
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

pub(super) async fn set_shuffle(cmd: &Command, playback: &Playback) -> String {
    let shuffle_result: Result<bool, ErrorBody> = match cmd.data.get("shuffle") {
        Some(v) => v
            .as_bool()
            .ok_or_else(|| ErrorBody::new(ErrorCode::InvalidRequest, "shuffle must be a boolean")),
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

pub(super) async fn set_repeat(cmd: &Command, playback: &Playback) -> String {
    let repeat_result: Result<&str, ErrorBody> = match cmd.data.get("repeat") {
        Some(v) => v
            .as_str()
            .ok_or_else(|| ErrorBody::new(ErrorCode::InvalidRequest, "repeat must be a string")),
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

pub(super) async fn set_autoplay(cmd: &Command, playback: &Playback) -> String {
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
