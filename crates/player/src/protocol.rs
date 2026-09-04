use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Process-global monotonic event sequence counter shared across
/// subsystems (auth, playback, lyrics, visualizer).
pub static NEXT_EVENT_SEQ: AtomicU64 = AtomicU64::new(0);

/// Reserve and return the next monotonic event sequence number.
pub fn next_event_seq() -> u64 {
    NEXT_EVENT_SEQ
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
}

pub const PROTOCOL_VERSION: u32 = 1;
pub const SUPPORTED_PROTOCOLS: &[u32] = &[PROTOCOL_VERSION];
pub const PLAYER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_LINE_BYTES: usize = 1 << 20; // 1 MiB
pub const MAX_ID_BYTES: usize = 64;
pub const PROTOCOL_STDOUT_CAP: usize = 1024;
pub const VIZ_STDOUT_CAP: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    AuthRequired,
    AuthDenied,
    AuthFailed,
    ApiUnavailable,
    PlayerUnavailable,
    PlaybackFailed,
    AudioDeviceUnavailable,
    LyricsUnavailable,
    InvalidRequest,
    Unsupported,
    Timeout,
    Internal,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthRequired => "AUTH_REQUIRED",
            Self::AuthDenied => "AUTH_DENIED",
            Self::AuthFailed => "AUTH_FAILED",
            Self::ApiUnavailable => "API_UNAVAILABLE",
            Self::PlayerUnavailable => "PLAYER_UNAVAILABLE",
            Self::PlaybackFailed => "PLAYBACK_FAILED",
            Self::AudioDeviceUnavailable => "AUDIO_DEVICE_UNAVAILABLE",
            Self::LyricsUnavailable => "LYRICS_UNAVAILABLE",
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::Unsupported => "UNSUPPORTED",
            Self::Timeout => "TIMEOUT",
            Self::Internal => "INTERNAL",
        }
    }

    pub const fn is_retryable(self) -> bool {
        matches!(
            self,
            Self::Timeout | Self::ApiUnavailable | Self::PlayerUnavailable
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("invalid JSON at line {line}, col {col}")]
    Json { line: usize, col: usize },
    #[error("line exceeds max allowed length ({0} bytes)")]
    LineTooLong(usize),
    #[error("id exceeds max allowed length ({0} bytes)")]
    IdTooLong(usize),
    #[error("unsupported protocol major version: {0}")]
    UnsupportedVersion(u32),
    #[error("missing or wrong field: {0}")]
    MissingField(&'static str),
}

#[derive(Debug, Deserialize)]
pub struct Command {
    #[serde(rename = "v")]
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Serialize)]
pub struct ResponseOk<'a> {
    #[serde(rename = "v")]
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub id: &'a str,
    pub ok: bool,
    pub data: Value,
}

#[derive(Debug, Serialize)]
pub struct ResponseErr<'a> {
    #[serde(rename = "v")]
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub id: &'a str,
    pub ok: bool,
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct EventOut<'a> {
    #[serde(rename = "v")]
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub event: &'a str,
    pub seq: u64,
    pub data: Value,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            retryable: code.is_retryable(),
            code,
            message: message.into(),
            detail: None,
        }
    }
}

pub fn cap_id(id: &str) -> &str {
    if id.len() > MAX_ID_BYTES {
        &id[..MAX_ID_BYTES]
    } else {
        id
    }
}

pub fn ok(id: &str, data: Value) -> String {
    let r = ResponseOk {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: cap_id(id),
        ok: true,
        data,
    };
    serde_json::to_string(&r).expect("response serialization")
}

pub fn err(id: &str, body: ErrorBody) -> String {
    let r = ResponseErr {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: cap_id(id),
        ok: false,
        error: body,
    };
    serde_json::to_string(&r).expect("response serialization")
}

pub fn event(event_name: &str, seq: u64, data: Value) -> String {
    let e = EventOut {
        version: PROTOCOL_VERSION,
        kind: "event",
        event: event_name,
        seq,
        data,
    };
    serde_json::to_string(&e).expect("event serialization")
}

pub fn parse_command(line: &str) -> Result<Command, ProtocolError> {
    if line.len() > MAX_LINE_BYTES {
        return Err(ProtocolError::LineTooLong(line.len()));
    }
    let cmd: Command = serde_json::from_str(line).map_err(|e| ProtocolError::Json {
        line: e.line(),
        col: e.column(),
    })?;
    if !SUPPORTED_PROTOCOLS.contains(&cmd.version) {
        return Err(ProtocolError::UnsupportedVersion(cmd.version));
    }
    if cmd.kind != "command" {
        return Err(ProtocolError::MissingField("type=command"));
    }
    if cmd.id.is_empty() {
        return Err(ProtocolError::MissingField("id"));
    }
    if cmd.id.len() > MAX_ID_BYTES {
        return Err(ProtocolError::IdTooLong(cmd.id.len()));
    }
    Ok(cmd)
}
