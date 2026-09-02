//! `spotoei-player` — playback core sidecar.
//!
//! Milestone 0 scope (per TSD 10 §2):
//!   * NDJSON over stdin/stdout, debug logs to stderr (TSD 06 §1).
//!   * Handshake: read `hello` command, reply with selected protocol +
//!     version + capabilities (TSD 06 §5).
//!   * `shutdown` exits cleanly.
//!   * Anything non-protocol on stdout is a violation; logs go to stderr.

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
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
enum ProtocolError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
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
    code: &'static str,
    message: String,
    retryable: bool,
}

fn invalid_request(msg: impl Into<String>) -> ErrorBody {
    ErrorBody {
        code: "INVALID_REQUEST",
        message: msg.into(),
        retryable: false,
    }
}

fn timeout() -> ErrorBody {
    ErrorBody {
        code: "TIMEOUT",
        message: "command timed out".into(),
        retryable: true,
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
    let cmd: Command = serde_json::from_str(line)?;
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

fn handle(cmd: Command) -> String {
    match cmd.command.as_str() {
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
        other => err(&cmd.id, invalid_request(format!("unknown command: {other}"))),
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    init_tracing();

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut lines = BufReader::new(stdin).lines();

    info!(version = PLAYER_VERSION, "spotoei-player starting");

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
            error!("handshake timeout");
            let _ = writeln_stdout(&mut stdout, &err("handshake", timeout())).await;
            return ExitCode::from(2);
        }
    };

    let hello_cmd = match parse_command(&hello_line) {
        Ok(c) if c.command == "hello" => c,
        Ok(c) => {
            let _ = writeln_stdout(&mut stdout, &err(&c.id, invalid_request("expected hello first"))).await;
            return ExitCode::from(2);
        }
        Err(e) => {
            let _ = writeln_stdout(&mut stdout, &err("handshake", invalid_request(e.to_string()))).await;
            return ExitCode::from(2);
        }
    };

    let hello_reply = handle(hello_cmd);
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

                let is_shutdown = line.contains("\"command\":\"shutdown\"");

                let reply = match tokio::time::timeout(COMMAND_TIMEOUT, async {
                    parse_command(&line).map(handle)
                })
                .await
                {
                    Ok(Ok(reply)) => reply,
                    Ok(Err(e)) => {
                        warn!(error = %e, "command parse failed");
                        err("unknown", invalid_request(e.to_string()))
                    }
                    Err(_) => err("unknown", timeout()),
                };

                if let Err(e) = writeln_stdout(&mut stdout, &reply).await {
                    error!(error = %e, "failed to write reply");
                    return ExitCode::from(2);
                }

                if is_shutdown {
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
