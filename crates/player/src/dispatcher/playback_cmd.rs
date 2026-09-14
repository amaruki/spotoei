mod audio_config;
mod audio_settings;
mod controls;
mod load;
#[cfg(test)]
mod tests;

use serde_json::Value;

use crate::playback::{Playback, PlaybackError};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

use audio_config::{get_audio_config, set_audio_config};
use audio_settings::{
    set_audio_backend, set_bitrate, set_crossfade, set_device_mode, set_normalisation,
    set_normalisation_type, set_pregain,
};
use controls::{set_autoplay, set_repeat, set_shuffle, set_volume};
use load::{load, seek, seek_relative};

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
        "playback.seek_relative" => seek_relative(cmd, playback).await,
        "playback.set_volume" => set_volume(cmd, playback).await,
        "playback.toggle_mute" => match playback.toggle_mute().await {
            Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
            Err(PlaybackError) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::PlaybackFailed, "toggle_mute failed"),
            ),
        },
        "playback.set_shuffle" => set_shuffle(cmd, playback).await,
        "playback.set_repeat" => set_repeat(cmd, playback).await,
        "playback.set_autoplay" => set_autoplay(cmd, playback).await,
        "playback.set_device_mode" => set_device_mode(cmd, playback).await,
        "playback.get_device_mode" => {
            let mode = playback.device_mode().await;
            ok(&cmd.id, serde_json::json!({ "deviceMode": mode.as_str() }))
        }
        "playback.set_audio_backend" => set_audio_backend(cmd, playback).await,
        "playback.get_audio_backend" => {
            let backend = playback.audio_backend().await;
            ok(
                &cmd.id,
                serde_json::json!({ "audioBackend": backend.as_str() }),
            )
        }
        "playback.set_bitrate" => set_bitrate(cmd, playback).await,
        "playback.get_bitrate" => {
            let bitrate = playback.bitrate().await;
            ok(&cmd.id, serde_json::json!({ "bitrate": bitrate.as_str() }))
        }
        "playback.set_crossfade" => set_crossfade(cmd, playback).await,
        "playback.get_crossfade" => {
            let crossfade = playback.crossfade_duration_ms().await;
            ok(
                &cmd.id,
                serde_json::json!({ "crossfadeDurationMs": crossfade }),
            )
        }
        "playback.set_normalisation" => set_normalisation(cmd, playback).await,
        "playback.get_normalisation" => {
            let norm = playback.normalisation().await;
            ok(&cmd.id, serde_json::json!({ "normalisation": norm }))
        }
        "playback.set_normalisation_type" => set_normalisation_type(cmd, playback).await,
        "playback.get_normalisation_type" => {
            let norm_type = playback.normalisation_type().await;
            ok(
                &cmd.id,
                serde_json::json!({ "normalisationType": norm_type }),
            )
        }
        "playback.set_pregain" => set_pregain(cmd, playback).await,
        "playback.get_pregain" => {
            let pregain = playback.pregain().await;
            ok(&cmd.id, serde_json::json!({ "pregain": pregain }))
        }
        "playback.get_audio_config" => get_audio_config(cmd, playback).await,
        "playback.set_audio_config" => set_audio_config(cmd, playback).await,
        _ => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::InvalidRequest,
                format!("unknown command: {command}"),
            ),
        ),
    }
}
