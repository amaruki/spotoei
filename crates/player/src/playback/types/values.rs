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
    #[serde(
        rename = "160",
        alias = "bitrate160",
        alias = "160k",
        alias = "160kbps"
    )]
    Bitrate160,
    #[default]
    #[serde(
        rename = "320",
        alias = "bitrate320",
        alias = "320k",
        alias = "320kbps"
    )]
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
        match s
            .trim()
            .to_ascii_lowercase()
            .trim_end_matches("kbps")
            .trim_end_matches('k')
            .trim()
        {
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
