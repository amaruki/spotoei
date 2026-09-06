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
            ok(&cmd.id, serde_json::json!({ "audioBackend": backend.as_str() }))
        }
        "playback.set_bitrate" => set_bitrate(cmd, playback).await,
        "playback.get_bitrate" => {
            let bitrate = playback.bitrate().await;
            ok(&cmd.id, serde_json::json!({ "bitrate": bitrate.as_str() }))
        }
        "playback.set_crossfade" => set_crossfade(cmd, playback).await,
        "playback.get_crossfade" => {
            let crossfade = playback.crossfade_duration_ms().await;
            ok(&cmd.id, serde_json::json!({ "crossfadeDurationMs": crossfade }))
        }
        "playback.set_normalisation" => set_normalisation(cmd, playback).await,
        "playback.get_normalisation" => {
            let norm = playback.normalisation().await;
            ok(&cmd.id, serde_json::json!({ "normalisation": norm }))
        }
        "playback.set_normalisation_type" => set_normalisation_type(cmd, playback).await,
        "playback.get_normalisation_type" => {
            let norm_type = playback.normalisation_type().await;
            ok(&cmd.id, serde_json::json!({ "normalisationType": norm_type }))
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

async fn load(cmd: &Command, playback: &Playback) -> String {
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
    let _ = playback.set_autoplay(autoplay).await;
    match playback
        .load_opts(
            LoadRequest {
                context_uri,
                track_uri,
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
        Ok(snap) => ok(
            &cmd.id,
            serde_json::to_value(&snap).unwrap_or(Value::Null),
        ),
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

async fn seek_relative(cmd: &Command, playback: &Playback) -> String {
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
                ErrorBody::new(ErrorCode::PlaybackFailed, "seek_relative failed; no track loaded"),
            ),
        },
        Err(e) => err(&cmd.id, e),
    }
}

async fn set_volume(cmd: &Command, playback: &Playback) -> String {
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

async fn set_shuffle(cmd: &Command, playback: &Playback) -> String {
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

async fn set_repeat(cmd: &Command, playback: &Playback) -> String {
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

async fn set_device_mode(cmd: &Command, playback: &Playback) -> String {
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

async fn set_audio_backend(cmd: &Command, playback: &Playback) -> String {
    let backend_val = cmd
        .data
        .get("audioBackend")
        .or_else(|| cmd.data.get("audio_backend"))
        .and_then(|v| v.as_str());
    match backend_val {
        Some(s) => match s.parse::<crate::playback::AudioBackend>() {
            Ok(backend) => {
                let actual = playback.set_audio_backend(backend).await;
                ok(&cmd.id, serde_json::json!({ "audioBackend": actual.as_str() }))
            }
            Err(e) => err(&cmd.id, ErrorBody::new(ErrorCode::InvalidRequest, e)),
        },
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing required audioBackend"),
        ),
    }
}

async fn set_bitrate(cmd: &Command, playback: &Playback) -> String {
    let bitrate_val = cmd
        .data
        .get("bitrate")
        .and_then(|v| {
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

async fn set_crossfade(cmd: &Command, playback: &Playback) -> String {
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
            ok(&cmd.id, serde_json::json!({ "crossfadeDurationMs": actual }))
        }
        None => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, "missing crossfade duration in ms"),
        ),
    }
}

async fn set_normalisation(cmd: &Command, playback: &Playback) -> String {
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

async fn set_normalisation_type(cmd: &Command, playback: &Playback) -> String {
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

async fn set_pregain(cmd: &Command, playback: &Playback) -> String {
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

async fn get_audio_config(cmd: &Command, playback: &Playback) -> String {
    let mode = playback.device_mode().await;
    let backend = playback.audio_backend().await;
    let bitrate = playback.bitrate().await;
    let crossfade = playback.crossfade_duration_ms().await;
    let norm = playback.normalisation().await;
    let pregain = playback.pregain().await;
    ok(
        &cmd.id,
        serde_json::json!({
            "deviceMode": mode.as_str(),
            "device_mode": mode.as_str(),
            "audioBackend": backend.as_str(),
            "audio_backend": backend.as_str(),
            "bitrate": bitrate.as_str(),
            "crossfadeDurationMs": crossfade,
            "crossfade_duration_ms": crossfade,
            "normalisation": norm,
            "pregain": pregain,
        }),
    )
}

async fn set_audio_config(cmd: &Command, playback: &Playback) -> String {
    if let Some(mode_val) = cmd
        .data
        .get("deviceMode")
        .or_else(|| cmd.data.get("device_mode"))
        .and_then(|v| v.as_str())
    {
        if let Ok(mode) = mode_val.parse::<crate::playback::DeviceMode>() {
            playback.set_device_mode(mode).await;
        }
    }

    if let Some(backend_val) = cmd
        .data
        .get("audioBackend")
        .or_else(|| cmd.data.get("audio_backend"))
        .and_then(|v| v.as_str())
    {
        if let Ok(backend) = backend_val.parse::<crate::playback::AudioBackend>() {
            playback.set_audio_backend(backend).await;
        }
    }

    if let Some(bitrate_val) = cmd.data.get("bitrate").and_then(|v| {
        if let Some(s) = v.as_str() {
            s.parse::<crate::playback::Bitrate>().ok()
        } else if let Some(n) = v.as_u64() {
            crate::playback::Bitrate::try_from(n as u32).ok()
        } else {
            None
        }
    }) {
        playback.set_bitrate(bitrate_val).await;
    }

    if let Some(ms) = cmd
        .data
        .get("crossfadeDurationMs")
        .or_else(|| cmd.data.get("crossfade_duration_ms"))
        .or_else(|| cmd.data.get("crossfadeMs"))
        .or_else(|| cmd.data.get("crossfade_ms"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
    {
        playback.set_crossfade_duration_ms(ms).await;
    }

    if let Some(norm) = cmd
        .data
        .get("normalisation")
        .or_else(|| cmd.data.get("normalization"))
        .and_then(|v| v.as_bool())
    {
        playback.set_normalisation(norm).await;
    }

    if let Some(norm_type) = cmd
        .data
        .get("normalisationType")
        .or_else(|| cmd.data.get("normalisation_type"))
        .or_else(|| cmd.data.get("normalizationType"))
        .or_else(|| cmd.data.get("normalization_type"))
        .and_then(|v| v.as_str())
    {
        playback.set_normalisation_type(norm_type).await;
    }

    if let Some(pregain) = cmd
        .data
        .get("pregain")
        .and_then(|v| v.as_f64())
        .map(|f| f as f32)
    {
        playback.set_pregain(pregain).await;
    }

    get_audio_config(cmd, playback).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playback::FakeEngine;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_dispatch_seek_relative_and_toggle_mute() {
        let (tx, _rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        pb.load(crate::playback::LoadRequest {
            context_uri: None,
            track_uri: Some("spotify:track:test_cmd"),
            name: None,
            artists: None,
            album: None,
            duration_ms: Some(50_000),
            genre: None,
        })
        .await
        .unwrap();

        let cmd_seek_rel = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-1".to_string(),
            command: "playback.seek_relative".to_string(),
            data: serde_json::json!({ "offsetMs": 10000 }),
        };
        let res = dispatch("playback.seek_relative", &cmd_seek_rel, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"positionMs\":10000"));

        let cmd_toggle = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-2".to_string(),
            command: "playback.toggle_mute".to_string(),
            data: serde_json::json!({}),
        };
        let res = dispatch("playback.toggle_mute", &cmd_toggle, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"volume\":0.0"));
    }

    #[tokio::test]
    async fn test_dispatch_device_mode_and_audio_backend() {
        let (tx, _rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        let cmd_get_mode = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-mode-1".to_string(),
            command: "playback.get_device_mode".to_string(),
            data: serde_json::json!({}),
        };
        let res = dispatch("playback.get_device_mode", &cmd_get_mode, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"deviceMode\":\"integrated\""));

        let cmd_set_mode = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-mode-2".to_string(),
            command: "playback.set_device_mode".to_string(),
            data: serde_json::json!({ "deviceMode": "connect_only" }),
        };
        let res = dispatch("playback.set_device_mode", &cmd_set_mode, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"deviceMode\":\"connect_only\""));

        let cmd_set_backend = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-backend-1".to_string(),
            command: "playback.set_audio_backend".to_string(),
            data: serde_json::json!({ "audioBackend": "dummy" }),
        };
        let res = dispatch("playback.set_audio_backend", &cmd_set_backend, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"audioBackend\":\"dummy\""));

        let cmd_get_backend = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-backend-2".to_string(),
            command: "playback.get_audio_backend".to_string(),
            data: serde_json::json!({}),
        };
        let res = dispatch("playback.get_audio_backend", &cmd_get_backend, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"audioBackend\":\"dummy\""));
    }

    #[tokio::test]
    async fn test_dispatch_bitrate_crossfade_normalisation() {
        let (tx, _rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        let cmd_get_b = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-b-1".to_string(),
            command: "playback.get_bitrate".to_string(),
            data: serde_json::json!({}),
        };
        let res = dispatch("playback.get_bitrate", &cmd_get_b, &pb).await;
        assert!(res.contains("\"bitrate\":\"320\""));

        let cmd_set_b = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-b-2".to_string(),
            command: "playback.set_bitrate".to_string(),
            data: serde_json::json!({ "bitrate": "160" }),
        };
        let res = dispatch("playback.set_bitrate", &cmd_set_b, &pb).await;
        assert!(res.contains("\"bitrate\":\"160\""));

        let cmd_set_cf = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-cf-1".to_string(),
            command: "playback.set_crossfade".to_string(),
            data: serde_json::json!({ "crossfadeDurationMs": 3000 }),
        };
        let res = dispatch("playback.set_crossfade", &cmd_set_cf, &pb).await;
        assert!(res.contains("\"crossfadeDurationMs\":3000"));

        let cmd_set_norm = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-n-1".to_string(),
            command: "playback.set_normalisation".to_string(),
            data: serde_json::json!({ "normalisation": false }),
        };
        let res = dispatch("playback.set_normalisation", &cmd_set_norm, &pb).await;
        assert!(res.contains("\"normalisation\":false"));

        let cmd_set_nt = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-nt-1".to_string(),
            command: "playback.set_normalisation_type".to_string(),
            data: serde_json::json!({ "normalisationType": "track" }),
        };
        let res = dispatch("playback.set_normalisation_type", &cmd_set_nt, &pb).await;
        assert!(res.contains("\"normalisationType\":\"track\""));

        let cmd_set_pg = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-pg-1".to_string(),
            command: "playback.set_pregain".to_string(),
            data: serde_json::json!({ "pregain": 2.5 }),
        };
        let res = dispatch("playback.set_pregain", &cmd_set_pg, &pb).await;
        assert!(res.contains("\"pregain\":2.5"));

        let cmd_get_cfg = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-cfg-1".to_string(),
            command: "playback.get_audio_config".to_string(),
            data: serde_json::json!({}),
        };
        let res = dispatch("playback.get_audio_config", &cmd_get_cfg, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"bitrate\":"));
        assert!(res.contains("\"audioBackend\":"));
        assert!(res.contains("\"crossfadeDurationMs\":"));
        assert!(res.contains("\"deviceMode\":"));
        assert!(res.contains("\"normalisation\":"));
        assert!(res.contains("\"pregain\":"));

        let cmd_set_cfg = Command {
            version: crate::protocol::PROTOCOL_VERSION,
            kind: "command".to_string(),
            id: "cmd-cfg-2".to_string(),
            command: "playback.set_audio_config".to_string(),
            data: serde_json::json!({
                "bitrate": "96",
                "crossfadeDurationMs": 5000,
                "normalisation": false,
                "pregain": -1.5,
            }),
        };
        let res = dispatch("playback.set_audio_config", &cmd_set_cfg, &pb).await;
        assert!(res.contains("\"ok\":true"));
        assert!(res.contains("\"bitrate\":\"96\""));
        assert!(res.contains("\"crossfadeDurationMs\":5000"));
        assert!(res.contains("\"normalisation\":false"));
        assert!(res.contains("\"pregain\":-1.5"));
    }
}
