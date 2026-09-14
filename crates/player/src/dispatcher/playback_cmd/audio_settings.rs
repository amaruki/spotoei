use serde_json::Value;

use crate::playback::Playback;
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub(super) async fn set_device_mode(cmd: &Command, playback: &Playback) -> String {
    let mode_val = cmd
        .data
        .get("deviceMode")
        .or_else(|| cmd.data.get("device_mode"))
        .and_then(|v| v.as_str());
    match mode_val {
        Some(s) => match s.parse::<crate::playback::DeviceMode>() {
            Ok(mode) => {
                let snap = playback.set_device_mode(mode).await;
                ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null))
            }
            Err(e) => err(&cmd.id, ErrorBody::new(ErrorCode::InvalidRequest, e)),
        },
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing required deviceMode"),
        ),
    }
}

pub(super) async fn set_audio_backend(cmd: &Command, playback: &Playback) -> String {
    let backend_val = cmd
        .data
        .get("audioBackend")
        .or_else(|| cmd.data.get("audio_backend"))
        .and_then(|v| v.as_str());
    match backend_val {
        Some(s) => match s.parse::<crate::playback::AudioBackend>() {
            Ok(backend) => {
                let actual = playback.set_audio_backend(backend).await;
                ok(
                    &cmd.id,
                    serde_json::json!({ "audioBackend": actual.as_str() }),
                )
            }
            Err(e) => err(&cmd.id, ErrorBody::new(ErrorCode::InvalidRequest, e)),
        },
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing required audioBackend"),
        ),
    }
}

pub(super) async fn set_bitrate(cmd: &Command, playback: &Playback) -> String {
    let bitrate_val = cmd.data.get("bitrate").and_then(|v| {
        if let Some(s) = v.as_str() {
            s.parse::<crate::playback::Bitrate>().ok()
        } else if let Some(n) = v.as_u64() {
            crate::playback::Bitrate::try_from(n as u32).ok()
        } else {
            None
        }
    });
    match bitrate_val {
        Some(b) => {
            let actual = playback.set_bitrate(b).await;
            ok(&cmd.id, serde_json::json!({ "bitrate": actual.as_str() }))
        }
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "invalid or missing bitrate"),
        ),
    }
}

pub(super) async fn set_crossfade(cmd: &Command, playback: &Playback) -> String {
    let ms = cmd
        .data
        .get("crossfadeDurationMs")
        .or_else(|| cmd.data.get("crossfade_duration_ms"))
        .or_else(|| cmd.data.get("crossfadeMs"))
        .or_else(|| cmd.data.get("crossfade_ms"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    match ms {
        Some(val) => {
            let actual = playback.set_crossfade_duration_ms(val).await;
            ok(
                &cmd.id,
                serde_json::json!({ "crossfadeDurationMs": actual }),
            )
        }
        None => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::InvalidRequest,
                "missing crossfade duration in ms",
            ),
        ),
    }
}

pub(super) async fn set_normalisation(cmd: &Command, playback: &Playback) -> String {
    let norm = cmd
        .data
        .get("normalisation")
        .or_else(|| cmd.data.get("normalization"))
        .and_then(|v| v.as_bool());
    match norm {
        Some(val) => {
            let actual = playback.set_normalisation(val).await;
            ok(&cmd.id, serde_json::json!({ "normalisation": actual }))
        }
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing normalisation boolean"),
        ),
    }
}

pub(super) async fn set_normalisation_type(cmd: &Command, playback: &Playback) -> String {
    let norm_type = cmd
        .data
        .get("normalisationType")
        .or_else(|| cmd.data.get("normalisation_type"))
        .or_else(|| cmd.data.get("normalizationType"))
        .or_else(|| cmd.data.get("normalization_type"))
        .and_then(|v| v.as_str());
    match norm_type {
        Some(val) => {
            let actual = playback.set_normalisation_type(val).await;
            ok(&cmd.id, serde_json::json!({ "normalisationType": actual }))
        }
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing normalisationType"),
        ),
    }
}

pub(super) async fn set_pregain(cmd: &Command, playback: &Playback) -> String {
    let pregain = cmd
        .data
        .get("pregain")
        .and_then(|v| v.as_f64())
        .map(|f| f as f32);
    match pregain {
        Some(val) => {
            let actual = playback.set_pregain(val).await;
            ok(&cmd.id, serde_json::json!({ "pregain": actual }))
        }
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing pregain number"),
        ),
    }
}
