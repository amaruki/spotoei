use super::values::{AudioBackend, Bitrate, DeviceMode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibrespotConfig {
    #[serde(default)]
    pub device_mode: DeviceMode,
    #[serde(default)]
    pub audio_backend: AudioBackend,
    #[serde(default = "default_device_name")]
    pub device_name: String,
    #[serde(default)]
    pub audio_device: Option<String>,
    #[serde(default = "default_true")]
    pub gapless: bool,
    #[serde(default = "default_true")]
    pub normalisation: bool,
    #[serde(default)]
    pub bitrate: Bitrate,
    #[serde(default)]
    pub crossfade_duration_ms: u32,
    #[serde(default = "default_normalisation_type")]
    pub normalisation_type: String,
    #[serde(default)]
    pub pregain: f32,
}

fn default_device_name() -> String {
    "Spotoei".to_string()
}

const fn default_true() -> bool {
    true
}

fn default_normalisation_type() -> String {
    "album".to_string()
}

impl Default for LibrespotConfig {
    fn default() -> Self {
        Self {
            device_mode: DeviceMode::Integrated,
            audio_backend: AudioBackend::Rodio,
            device_name: default_device_name(),
            audio_device: None,
            gapless: true,
            normalisation: true,
            bitrate: Bitrate::Bitrate320,
            crossfade_duration_ms: 0,
            normalisation_type: "album".to_string(),
            pregain: 0.0,
        }
    }
}

impl LibrespotConfig {
    pub fn resolve() -> Self {
        let mut cfg = Self::default();

        if let Ok(file_cfg) = Self::load_from_config_file() {
            if let Some(mode) = file_cfg.device_mode {
                cfg.device_mode = mode;
            }
            if let Some(backend) = file_cfg.audio_backend {
                cfg.audio_backend = backend;
            }
            if let Some(name) = file_cfg.device_name {
                if !name.trim().is_empty() {
                    cfg.device_name = name;
                }
            }
            if let Some(device) = file_cfg.audio_device {
                if !device.trim().is_empty() {
                    cfg.audio_device = Some(device);
                }
            }
            if let Some(gapless) = file_cfg.gapless {
                cfg.gapless = gapless;
            }
            if let Some(norm) = file_cfg.normalisation {
                cfg.normalisation = norm;
            }
            if let Some(bitrate) = file_cfg.bitrate {
                cfg.bitrate = bitrate;
            }
            if let Some(crossfade) = file_cfg.crossfade_duration_ms {
                cfg.crossfade_duration_ms = crossfade.min(15000);
            }
            if let Some(norm_type) = file_cfg.normalisation_type {
                if !norm_type.trim().is_empty() {
                    cfg.normalisation_type = norm_type;
                }
            }
            if let Some(pregain) = file_cfg.pregain {
                cfg.pregain = pregain;
            }
        }

        if let Ok(mode_str) = std::env::var("SPOTOEI_DEVICE_MODE") {
            if let Ok(mode) = mode_str.parse::<DeviceMode>() {
                cfg.device_mode = mode;
            }
        }
        if let Ok(backend_str) = std::env::var("SPOTOEI_AUDIO_BACKEND") {
            if let Ok(backend) = backend_str.parse::<AudioBackend>() {
                cfg.audio_backend = backend;
            }
        }
        if let Ok(name_str) = std::env::var("SPOTOEI_DEVICE_NAME") {
            if !name_str.trim().is_empty() {
                cfg.device_name = name_str.trim().to_string();
            }
        }
        if let Ok(dev_str) = std::env::var("SPOTOEI_AUDIO_DEVICE") {
            if !dev_str.trim().is_empty() {
                cfg.audio_device = Some(dev_str.trim().to_string());
            }
        }
        if let Ok(bitrate_str) = std::env::var("SPOTOEI_BITRATE") {
            if let Ok(bitrate) = bitrate_str.parse::<Bitrate>() {
                cfg.bitrate = bitrate;
            }
        }
        if let Ok(crossfade_str) = std::env::var("SPOTOEI_CROSSFADE_MS") {
            if let Ok(ms) = crossfade_str.parse::<u32>() {
                cfg.crossfade_duration_ms = ms.min(15000);
            }
        }
        if let Ok(norm_type_str) = std::env::var("SPOTOEI_NORMALISATION_TYPE") {
            if !norm_type_str.trim().is_empty() {
                cfg.normalisation_type = norm_type_str.trim().to_string();
            }
        }
        if let Ok(pregain_str) = std::env::var("SPOTOEI_NORMALISATION_PREGAIN") {
            if let Ok(val) = pregain_str.parse::<f32>() {
                cfg.pregain = val;
            }
        }

        cfg
    }

    fn load_from_config_file() -> Result<RawPlaybackConfig, ()> {
        let config_dir = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".config"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
            });
        let config_path = config_dir.join("spotoei").join("config.json");
        let content = std::fs::read_to_string(&config_path).map_err(|_| ())?;
        let val: serde_json::Value = serde_json::from_str(&content).map_err(|_| ())?;
        let pb = val.get("playback").ok_or(())?;
        let mode = pb
            .get("deviceMode")
            .or_else(|| pb.get("device_mode"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<DeviceMode>().ok());
        let backend = pb
            .get("audioBackend")
            .or_else(|| pb.get("audio_backend"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<AudioBackend>().ok());
        let name = pb
            .get("deviceName")
            .or_else(|| pb.get("device_name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let device = pb
            .get("audioDevice")
            .or_else(|| pb.get("audio_device"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let gapless = pb.get("gapless").and_then(|v| v.as_bool());
        let norm = pb
            .get("normalisation")
            .or_else(|| pb.get("normalization"))
            .and_then(|v| v.as_bool());
        let bitrate = pb.get("bitrate").and_then(|v| {
            if let Some(s) = v.as_str() {
                s.parse::<Bitrate>().ok()
            } else if let Some(n) = v.as_u64() {
                Bitrate::try_from(n as u32).ok()
            } else {
                None
            }
        });
        let crossfade = pb
            .get("crossfadeDurationMs")
            .or_else(|| pb.get("crossfade_duration_ms"))
            .or_else(|| pb.get("crossfadeMs"))
            .or_else(|| pb.get("crossfade_ms"))
            .and_then(|v| v.as_u64())
            .map(|n| n.min(15000) as u32);
        let norm_type = pb
            .get("normalisationType")
            .or_else(|| pb.get("normalisation_type"))
            .or_else(|| pb.get("normalizationType"))
            .or_else(|| pb.get("normalization_type"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let pregain = pb
            .get("pregain")
            .or_else(|| pb.get("normalisationPregain"))
            .or_else(|| pb.get("normalisation_pregain"))
            .or_else(|| pb.get("normalizationPregain"))
            .or_else(|| pb.get("normalization_pregain"))
            .and_then(|v| v.as_f64())
            .map(|f| f as f32);
        Ok(RawPlaybackConfig {
            device_mode: mode,
            audio_backend: backend,
            device_name: name,
            audio_device: device,
            gapless,
            normalisation: norm,
            bitrate,
            crossfade_duration_ms: crossfade,
            normalisation_type: norm_type,
            pregain,
        })
    }
}

#[derive(Default)]
struct RawPlaybackConfig {
    device_mode: Option<DeviceMode>,
    audio_backend: Option<AudioBackend>,
    device_name: Option<String>,
    audio_device: Option<String>,
    gapless: Option<bool>,
    normalisation: Option<bool>,
    bitrate: Option<Bitrate>,
    crossfade_duration_ms: Option<u32>,
    normalisation_type: Option<String>,
    pregain: Option<f32>,
}
