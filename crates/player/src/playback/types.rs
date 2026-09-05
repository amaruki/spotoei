use std::time::Instant;

use serde::{Deserialize, Serialize};

/// Authoritative UI-facing playback state. Stable, compact, additive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackState {
    Idle,
    Loading,
    Buffering,
    Playing,
    Paused,
    Reconnecting,
    Error,
}

impl PlaybackState {
    pub fn as_str(self) -> &'static str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Loading => "loading",
            PlaybackState::Buffering => "buffering",
            PlaybackState::Playing => "playing",
            PlaybackState::Paused => "paused",
            PlaybackState::Reconnecting => "reconnecting",
            PlaybackState::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    Context,
    Track,
}

impl RepeatMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::Context => "context",
            RepeatMode::Track => "track",
        }
    }

    pub fn from_str(s: &str) -> Option<RepeatMode> {
        match s {
            "off" => Some(RepeatMode::Off),
            "context" => Some(RepeatMode::Context),
            "track" => Some(RepeatMode::Track),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DeviceMode {
    #[default]
    Integrated,
    ConnectOnly,
}

impl DeviceMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Integrated => "integrated",
            Self::ConnectOnly => "connect_only",
        }
    }
}

impl std::fmt::Display for DeviceMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for DeviceMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "integrated" => Ok(Self::Integrated),
            "connect_only" | "connect" | "connectonly" => Ok(Self::ConnectOnly),
            other => Err(format!("unknown device mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AudioBackend {
    #[default]
    Rodio,
    Alsa,
    Pulseaudio,
    Dummy,
}

impl AudioBackend {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Rodio => "rodio",
            Self::Alsa => "alsa",
            Self::Pulseaudio => "pulseaudio",
            Self::Dummy => "dummy",
        }
    }
}

impl std::fmt::Display for AudioBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for AudioBackend {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "rodio" => Ok(Self::Rodio),
            "alsa" => Ok(Self::Alsa),
            "pulseaudio" | "pulse" => Ok(Self::Pulseaudio),
            "dummy" | "null" | "none" => Ok(Self::Dummy),
            other => Err(format!("unknown audio backend: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Bitrate {
    #[serde(rename = "96", alias = "bitrate96", alias = "96k", alias = "96kbps")]
    Bitrate96,
    #[serde(rename = "160", alias = "bitrate160", alias = "160k", alias = "160kbps")]
    Bitrate160,
    #[default]
    #[serde(rename = "320", alias = "bitrate320", alias = "320k", alias = "320kbps")]
    Bitrate320,
}

impl Bitrate {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bitrate96 => "96",
            Self::Bitrate160 => "160",
            Self::Bitrate320 => "320",
        }
    }

    pub const fn kbps(self) -> u32 {
        match self {
            Self::Bitrate96 => 96,
            Self::Bitrate160 => 160,
            Self::Bitrate320 => 320,
        }
    }
}

impl std::fmt::Display for Bitrate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for Bitrate {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().trim_end_matches("kbps").trim_end_matches('k').trim() {
            "96" | "bitrate96" => Ok(Self::Bitrate96),
            "160" | "bitrate160" => Ok(Self::Bitrate160),
            "320" | "bitrate320" => Ok(Self::Bitrate320),
            other => Err(format!("unknown bitrate: {other}")),
        }
    }
}

impl TryFrom<u32> for Bitrate {
    type Error = String;
    fn try_from(val: u32) -> Result<Self, Self::Error> {
        match val {
            96 => Ok(Self::Bitrate96),
            160 => Ok(Self::Bitrate160),
            320 => Ok(Self::Bitrate320),
            other => Err(format!("unsupported bitrate: {other}")),
        }
    }
}

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
        let bitrate = pb
            .get("bitrate")
            .and_then(|v| {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub uri: String,
    pub name: String,
    pub artists: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlaybackInner {
    pub revision: u64,
    pub state: PlaybackState,
    pub track: Option<Track>,
    pub context_uri: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub autoplay: bool,
    pub last_change_at: Instant,
    pub last_emitted_position_ms: u64,
    pub muted_volume: Option<f32>,
    pub device_mode: DeviceMode,
    pub audio_backend: AudioBackend,
    pub bitrate: Bitrate,
    pub crossfade_duration_ms: u32,
    pub normalisation: bool,
    pub normalisation_type: String,
    pub pregain: f32,
}

impl PlaybackInner {
    pub fn new() -> Self {
        Self {
            revision: 0,
            state: PlaybackState::Idle,
            track: None,
            context_uri: None,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
            autoplay: true,
            last_change_at: Instant::now(),
            last_emitted_position_ms: 0,
            muted_volume: None,
            device_mode: DeviceMode::Integrated,
            audio_backend: AudioBackend::Rodio,
            bitrate: Bitrate::Bitrate320,
            crossfade_duration_ms: 0,
            normalisation: true,
            normalisation_type: "album".to_string(),
            pregain: 0.0,
        }
    }
}

impl Default for PlaybackInner {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlaybackError;

/// Input for `Playback::load`. Bundled into a struct so the call site does
/// not have to remember positional argument order, and so clippy does not
/// flag the function for exceeding the 7-argument heuristic.
#[derive(Debug, Default, Clone)]
pub struct LoadRequest<'a> {
    pub context_uri: Option<&'a str>,
    pub track_uri: Option<&'a str>,
    pub name: Option<&'a str>,
    pub artists: Option<Vec<String>>,
    pub album: Option<&'a str>,
    pub duration_ms: Option<u64>,
    pub genre: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackChangedPayload {
    pub revision: u64,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<Track>,
    #[serde(rename = "positionMs")]
    pub position_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: String,
    pub autoplay: bool,
    #[serde(rename = "deviceMode", skip_serializing_if = "Option::is_none")]
    pub device_mode: Option<String>,
    #[serde(rename = "observedAtMonotonicMs")]
    pub observed_at_monotonic_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitrate_parsing_and_conversion() {
        assert_eq!("96".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
        assert_eq!("96k".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
        assert_eq!("96kbps".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
        assert_eq!("160".parse::<Bitrate>().unwrap(), Bitrate::Bitrate160);
        assert_eq!("160k".parse::<Bitrate>().unwrap(), Bitrate::Bitrate160);
        assert_eq!("320".parse::<Bitrate>().unwrap(), Bitrate::Bitrate320);
        assert_eq!("320kbps".parse::<Bitrate>().unwrap(), Bitrate::Bitrate320);
        assert_eq!(Bitrate::try_from(96).unwrap(), Bitrate::Bitrate96);
        assert_eq!(Bitrate::try_from(160).unwrap(), Bitrate::Bitrate160);
        assert_eq!(Bitrate::try_from(320).unwrap(), Bitrate::Bitrate320);
        assert!(Bitrate::try_from(256).is_err());
        assert_eq!(Bitrate::default(), Bitrate::Bitrate320);
        assert_eq!(Bitrate::Bitrate320.as_str(), "320");
        assert_eq!(Bitrate::Bitrate320.kbps(), 320);
    }

    #[test]
    fn test_bitrate_serde() {
        let json = "\"160\"";
        let b: Bitrate = serde_json::from_str(json).unwrap();
        assert_eq!(b, Bitrate::Bitrate160);
        let ser = serde_json::to_string(&b).unwrap();
        assert_eq!(ser, "\"160\"");
    }

    #[test]
    fn test_librespot_config_defaults() {
        let cfg = LibrespotConfig::default();
        assert_eq!(cfg.bitrate, Bitrate::Bitrate320);
        assert_eq!(cfg.crossfade_duration_ms, 0);
        assert_eq!(cfg.normalisation_type, "album");
        assert_eq!(cfg.pregain, 0.0);
        assert!(cfg.gapless);
        assert!(cfg.normalisation);
    }

    #[test]
    fn test_librespot_config_env_vars() {
        std::env::set_var("SPOTOEI_BITRATE", "96");
        std::env::set_var("SPOTOEI_CROSSFADE_MS", "4000");
        std::env::set_var("SPOTOEI_NORMALISATION_PREGAIN", "3.5");
        std::env::set_var("SPOTOEI_NORMALISATION_TYPE", "track");

        let cfg = LibrespotConfig::resolve();
        assert_eq!(cfg.bitrate, Bitrate::Bitrate96);
        assert_eq!(cfg.crossfade_duration_ms, 4000);
        assert_eq!(cfg.normalisation_type, "track");
        assert_eq!(cfg.pregain, 3.5);

        std::env::remove_var("SPOTOEI_BITRATE");
        std::env::remove_var("SPOTOEI_CROSSFADE_MS");
        std::env::remove_var("SPOTOEI_NORMALISATION_PREGAIN");
        std::env::remove_var("SPOTOEI_NORMALISATION_TYPE");
    }
}
