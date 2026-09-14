use crate::playback::Playback;
use crate::protocol::{ok, Command};

pub(super) async fn get_audio_config(cmd: &Command, playback: &Playback) -> String {
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

pub(super) async fn set_audio_config(cmd: &Command, playback: &Playback) -> String {
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
