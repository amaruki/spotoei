//! `spotoei-player` — playback core sidecar.
//!
//! NDJSON over stdin/stdout, debug logs to stderr.
//! Handshake: read `hello` command, reply with selected protocol +
//! version + capabilities.
//! `shutdown` exits cleanly.
//! Anything non-protocol on stdout is a protocol violation; logs go to stderr.

use std::process::ExitCode;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Stdout};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

const PROTOCOL_VERSION: u32 = 1;
const PLAYER_VERSION: &str = env!("CARGO_PKG_VERSION");
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_LINE_BYTES: usize = 1 << 20; // 1 MiB

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
        matches!(self, Self::Timeout | Self::ApiUnavailable | Self::PlayerUnavailable)
    }
}

#[derive(Debug, thiserror::Error)]
enum ProtocolError {
    #[error("invalid JSON at line {line}, col {col}")]
    Json { line: usize, col: usize },
    #[error("line exceeds max allowed length ({0} bytes)")]
    LineTooLong(usize),
    #[error("unsupported protocol major version: {0}")]
    UnsupportedVersion(u32),
    #[error("missing or wrong field: {0}")]
    MissingField(&'static str),
}

#[derive(Debug, Deserialize)]
struct Command {
    #[serde(rename = "v")]
    version: u32,
    #[serde(rename = "type")]
    kind: String,
    id: String,
    command: String,
    #[serde(default)]
    #[allow(dead_code)]
    data: Value,
}

#[derive(Debug, Serialize)]
struct ResponseOk<'a> {
    #[serde(rename = "v")]
    version: u32,
    #[serde(rename = "type")]
    kind: &'static str,
    id: &'a str,
    ok: bool,
    data: Value,
}

#[derive(Debug, Serialize)]
struct ResponseErr<'a> {
    #[serde(rename = "v")]
    version: u32,
    #[serde(rename = "type")]
    kind: &'static str,
    id: &'a str,
    ok: bool,
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: ErrorCode,
    message: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<Value>,
}

impl ErrorBody {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            retryable: code.is_retryable(),
            code,
            message: message.into(),
            detail: None,
        }
    }
}

fn ok(id: &str, data: Value) -> String {
    let r = ResponseOk {
        version: PROTOCOL_VERSION,
        kind: "response",
        id,
        ok: true,
        data,
    };
    serde_json::to_string(&r).expect("response serialization")
}

fn err(id: &str, body: ErrorBody) -> String {
    let r = ResponseErr {
        version: PROTOCOL_VERSION,
        kind: "response",
        id,
        ok: false,
        error: body,
    };
    serde_json::to_string(&r).expect("response serialization")
}

fn parse_command(line: &str) -> Result<Command, ProtocolError> {
    if line.len() > MAX_LINE_BYTES {
        return Err(ProtocolError::LineTooLong(line.len()));
    }
    let cmd: Command = serde_json::from_str(line).map_err(|e| ProtocolError::Json {
        line: e.line(),
        col: e.column(),
    })?;
    if cmd.version != PROTOCOL_VERSION {
        return Err(ProtocolError::UnsupportedVersion(cmd.version));
    }
    if cmd.kind != "command" {
        return Err(ProtocolError::MissingField("type=command"));
    }
    if cmd.id.is_empty() {
        return Err(ProtocolError::MissingField("id"));
    }
    Ok(cmd)
}

fn handle(cmd: Command) -> (String, bool) {
    let is_shutdown = cmd.command == "shutdown";
    let reply = match cmd.command.as_str() {
        "hello" => {
            let data = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "playerVersion": PLAYER_VERSION,
                "capabilities": Vec::<String>::new(),
            });
            ok(&cmd.id, data)
        }
        "shutdown" => ok(&cmd.id, serde_json::json!({})),
        "player.status" => ok(
            &cmd.id,
            serde_json::json!({
                "state": "ready",
                "session": "absent",
            }),
        ),
        other => err(
            &cmd.id,
            ErrorBody::new(ErrorCode::InvalidRequest, format!("unknown command: {other}")),
        ),
    };
    (reply, is_shutdown)
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    init_tracing();

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut lines = BufReader::new(stdin).lines();

    info!(version = PLAYER_VERSION, "spotoei-player starting");

    // First valid command must be `hello` within HANDSHAKE_TIMEOUT.
    // On failure or timeout, log to stderr and exit 2 without emitting
    // synthetic id responses on stdout (which would violate the contract).
    let hello_line: String = match tokio::time::timeout(HANDSHAKE_TIMEOUT, lines.next_line()).await {
        Ok(Ok(Some(l))) => l,
        Ok(Ok(None)) => {
            error!("stdin closed before hello");
            return ExitCode::from(2);
        }
        Ok(Err(e)) => {
            error!(error = %e, "stdin read error");
            return ExitCode::from(2);
        }
        Err(_) => {
            error!("handshake timeout (no hello within 5s)");
            return ExitCode::from(2);
        }
    };

    let hello_cmd = match parse_command(&hello_line) {
        Ok(c) if c.command == "hello" => c,
        Ok(c) => {
            error!(command = %c.command, "expected hello as first command");
            let _ = writeln_stdout(
                &mut stdout,
                &err(&c.id, ErrorBody::new(ErrorCode::InvalidRequest, "expected hello first")),
            )
            .await;
            return ExitCode::from(2);
        }
        Err(e) => {
            error!(error = %e, "handshake parse failed");
            return ExitCode::from(2);
        }
    };

    let (hello_reply, _) = handle(hello_cmd);
    if let Err(e) = writeln_stdout(&mut stdout, &hello_reply).await {
        error!(error = %e, "failed to write hello reply");
        return ExitCode::from(2);
    }

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = shutdown_tx.send(()).await;
        }
    });

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("ctrl-c received; exiting");
                return ExitCode::SUCCESS;
            }
            line_res = lines.next_line() => {
                let line: String = match line_res {
                    Ok(Some(l)) => l,
                    Ok(None) => {
                        info!("stdin closed; exiting");
                        return ExitCode::SUCCESS;
                    }
                    Err(e) => {
                        error!(error = %e, "stdin read error");
                        return ExitCode::from(2);
                    }
                };

                let (reply, should_exit) = match parse_command(&line) {
                    Ok(cmd) => handle(cmd),
                    Err(e) => {
                        // Post-handshake parse failure: the client sent malformed
                        // input. We have no correlated id to echo, and stdout
                        // is reserved for protocol responses. Log diagnostics
                        // to stderr and continue reading.
                        warn!(error = %e, "command parse failed");
                        continue;
                    }
                };

                if let Err(e) = writeln_stdout(&mut stdout, &reply).await {
                    error!(error = %e, "failed to write reply");
                    return ExitCode::from(2);
                }

                if should_exit {
                    info!("shutdown complete; exiting cleanly");
                    return ExitCode::SUCCESS;
                }
            }
        }
    }
}

async fn writeln_stdout(stdout: &mut Stdout, line: &str) -> std::io::Result<()> {
    stdout.write_all(line.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await
}

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}
