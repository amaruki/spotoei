use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};
use crate::visualizer::{VisualizerConfig, VisualizerMode};

pub async fn configure(cmd: &Command, visualizer_cfg: &Arc<RwLock<VisualizerConfig>>) -> String {
    let enabled = match cmd.data.get("enabled").and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => true,
    };
    let mode = if let Some(m) = cmd.data.get("mode").and_then(|v| v.as_str()) {
        match m {
            "spectrum" => VisualizerMode::Spectrum,
            "winamp" => VisualizerMode::Winamp,
            "oscilloscope" => VisualizerMode::Oscilloscope,
            "off" => VisualizerMode::Off,
            _ => {
                return err(
                    &cmd.id,
                    ErrorBody::new(
                        ErrorCode::InvalidRequest,
                        "mode must be spectrum|winamp|oscilloscope|off",
                    ),
                );
            }
        }
    } else {
        VisualizerMode::Spectrum
    };
    let fps = if let Some(f) = cmd.data.get("fps") {
        match f.as_u64() {
            Some(val) if (1..=120).contains(&val) => val as u32,
            _ => {
                return err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "fps must be between 1 and 120"),
                );
            }
        }
    } else {
        60
    };
    let bands = if let Some(b) = cmd.data.get("bands") {
        match b.as_u64() {
            Some(val) if (8..=256).contains(&val) => val as usize,
            _ => {
                return err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "bands must be between 8 and 256"),
                );
            }
        }
    } else {
        64
    };
    let waveform_samples = if let Some(w) = cmd.data.get("waveformSamples") {
        match w.as_u64() {
            Some(val) if (16..=512).contains(&val) => val as usize,
            _ => {
                return err(
                    &cmd.id,
                    ErrorBody::new(
                        ErrorCode::InvalidRequest,
                        "waveformSamples must be between 16 and 512",
                    ),
                );
            }
        }
    } else {
        120
    };

    let mut cfg = visualizer_cfg.write().await;
    // Off mode implies disabled regardless of explicit enabled flag.
    let effective_enabled = if mode == VisualizerMode::Off { false } else { enabled };
    cfg.enabled = effective_enabled;
    cfg.mode = mode;
    cfg.fps = fps;
    cfg.bands = bands;
    cfg.waveform_samples = waveform_samples;

    let mode_str = match mode {
        VisualizerMode::Winamp => "winamp",
        VisualizerMode::Oscilloscope => "oscilloscope",
        VisualizerMode::Off => "off",
        VisualizerMode::Spectrum => "spectrum",
    };

    ok(
        &cmd.id,
        serde_json::json!({
            "enabled": cfg.enabled,
            "mode": mode_str,
            "fps": cfg.fps,
            "bands": cfg.bands,
            "waveformSamples": cfg.waveform_samples,
        }),
    )
}

// Silence unused warning when `Value` is only used in early-return branches.
#[allow(dead_code)]
fn _force_use() -> Value {
    Value::Null
}
