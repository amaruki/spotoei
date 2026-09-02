//! `spotoei-player` — playback core sidecar.
//!
//! NDJSON over stdin/stdout, debug logs to stderr.
//! Handshake: read `hello` command, reply with selected protocol +
//! version + capabilities.
//! `shutdown` exits cleanly.
//! Anything non-protocol on stdout is a protocol violation; logs go to stderr.

mod auth;

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use auth::{AuthManager, AuthStatus};
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
struct EventOut<'a> {
    #[serde(rename = "v")]
    version: u32,
    #[serde(rename = "type")]
    kind: &'static str,
    event: &'a str,
    seq: u64,
    data: Value,
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

#[allow(dead_code)]
fn event(event_name: &str, seq: u64, data: Value) -> String {
    let e = EventOut {
        version: PROTOCOL_VERSION,
        kind: "event",
        event: event_name,
        seq,
        data,
    };
    serde_json::to_string(&e).expect("event serialization")
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

async fn handle(cmd: Command, auth: &Arc<AuthManager>) -> (String, bool) {
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
        "auth.status" => {
            let st = auth.status().await;
            ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null))
        }
        "auth.begin" => {
            let scopes = cmd.data.get("scopes").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(String::from))
                    .collect()
            });
            match auth.begin(scopes).await {
                Ok(st) => ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null)),
                Err(auth::AuthError::MissingClientId) => err(
                    &cmd.id,
                    ErrorBody::new(
                        ErrorCode::InvalidRequest,
                        "missing SPOTOEI_CLIENT_ID configuration",
                    ),
                ),
                Err(e) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::AuthFailed, format!("auth.begin failed: {e}")),
                ),
            }
        }
        "auth.logout" => match auth.logout().await {
            Ok(st) => ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null)),
            Err(e) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::AuthFailed, format!("auth.logout failed: {e}")),
            ),
        },
        "auth.get_web_token" => match auth.get_web_token().await {
            Ok((token, expires_at)) => ok(
                &cmd.id,
                serde_json::json!({
                    "accessToken": token,
                    "expiresAt": expires_at,
                }),
            ),
            Err(auth::AuthError::NotAuthenticated) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::AuthRequired, "not authenticated"),
            ),
            Err(e) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::AuthFailed,
                    format!("token fetch/refresh failed: {e}"),
                ),
            ),
        },
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

    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "doctor" {
        return run_doctor(&args[2..]).await;
    }

    let client_id = std::env::var("SPOTOEI_CLIENT_ID").unwrap_or_default();
    let auth = Arc::new(AuthManager::new(client_id));
    let _initial_status = auth.hydrate().await;

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut lines = BufReader::new(stdin).lines();

    info!(version = PLAYER_VERSION, "spotoei-player starting");

    // First valid command must be `hello` within HANDSHAKE_TIMEOUT.
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

    let (hello_reply, _) = handle(hello_cmd, &auth).await;
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
                    Ok(cmd) => handle(cmd, &auth).await,
                    Err(e) => {
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

async fn run_doctor(args: &[String]) -> ExitCode {
    let sub = args.first().map(|s| s.as_str()).unwrap_or("all");
    let client_id = std::env::var("SPOTOEI_CLIENT_ID").unwrap_or_default();
    let auth = AuthManager::new(client_id.clone());
    let status: AuthStatus = auth.hydrate().await;

    if sub == "all" || sub == "auth" {
        println!("=== SPOTOEI Doctor: Auth & Keyring ===");
        println!("Client ID: {}", if client_id.is_empty() { "<not set: SPOTOEI_CLIENT_ID>" } else { "<set>" });
        println!("Auth State: {:?}", status.state);
        println!("Storage Tier: {:?}", status.storage);
        println!("Account ID: {}", status.account_id.as_deref().unwrap_or("<none>"));
        println!("Scopes: {}", if status.scopes.is_empty() { "<none>".to_string() } else { status.scopes.join(", ") });
    }
    ExitCode::SUCCESS
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
