//! `spotoei-player` — playback core sidecar.
//!
//! NDJSON over stdin/stdout, debug logs to stderr.
//! Handshake: read `hello` command, reply with selected protocol +
//! version + capabilities.
//! `shutdown` exits cleanly.
//! Anything non-protocol on stdout is a protocol violation; logs go to stderr.

pub mod auth;
pub mod playback;
pub mod visualizer;

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use auth::{AuthManager, AuthStatus};
use playback::{FakeEngine, Playback, PlaybackError};
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

async fn handle(
    cmd: Command,
    auth: &Arc<AuthManager>,
    playback: &Playback<FakeEngine>,
    visualizer_cfg: &Arc<tokio::sync::RwLock<visualizer::VisualizerConfig>>,
) -> (String, bool) {
    let is_shutdown = cmd.command == "shutdown";
    let reply = match cmd.command.as_str() {
        "hello" => {
            let data = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "playerVersion": PLAYER_VERSION,
                "capabilities": vec!["visualizer.spectrum", "visualizer.waveform"],
            });
            ok(&cmd.id, data)
        }
        "shutdown" => ok(&cmd.id, serde_json::json!({})),
        "player.status" => {
            let snap = playback.snapshot().await;
            ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null))
        }
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
        "playback.load" => {
            let context_uri = cmd.data.get("contextUri").and_then(|v| v.as_str());
            let track_uri = cmd.data.get("trackUri").and_then(|v| v.as_str());
            let autoplay = cmd
                .data
                .get("autoplay")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let _ = playback.set_autoplay(autoplay).await;
            match playback.load(context_uri, track_uri).await {
                Ok(snap) => {
                    let final_snap = if autoplay {
                        match playback.play().await {
                            Ok(s) => s,
                            Err(_) => snap,
                        }
                    } else {
                        snap
                    };
                    ok(&cmd.id, serde_json::to_value(&final_snap).unwrap_or(Value::Null))
                }
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::PlaybackFailed, "failed to load track/context"),
                ),
            }
        }
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
        "playback.seek" => {
            let pos = cmd
                .data
                .get("positionMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            match playback.seek(pos).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::PlaybackFailed, "seek failed; no track loaded"),
                ),
            }
        }
        "playback.set_volume" => {
            let vol = cmd
                .data
                .get("volume")
                .and_then(|v| v.as_f64())
                .map(|v| v as f32)
                .unwrap_or(0.8);
            match playback.set_volume(vol).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "volume must be between 0.0 and 1.0"),
                ),
            }
        }
        "playback.set_shuffle" => {
            let shuffle = cmd
                .data
                .get("shuffle")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            match playback.set_shuffle(shuffle).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::PlaybackFailed, "set_shuffle failed"),
                ),
            }
        }
        "playback.set_repeat" => {
            let repeat = cmd
                .data
                .get("repeat")
                .and_then(|v| v.as_str())
                .unwrap_or("off");
            match playback.set_repeat(repeat).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "repeat mode must be off|context|track"),
                ),
            }
        }
        "playback.set_autoplay" => {
            let autoplay = cmd
                .data
                .get("autoplay")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            match playback.set_autoplay(autoplay).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::PlaybackFailed, "set_autoplay failed"),
                ),
            }
        }
        "visualizer.configure" => {
            let enabled = cmd.data.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let mode_str = cmd.data.get("mode").and_then(|v| v.as_str()).unwrap_or("spectrum");
            let mode = match mode_str {
                "winamp" => visualizer::VisualizerMode::Winamp,
                "oscilloscope" => visualizer::VisualizerMode::Oscilloscope,
                _ => visualizer::VisualizerMode::Spectrum,
            };
            let fps = cmd.data.get("fps").and_then(|v| v.as_u64()).unwrap_or(60) as u32;
            let bands = cmd.data.get("bands").and_then(|v| v.as_u64()).unwrap_or(64) as usize;
            let waveform_samples = cmd.data.get("waveformSamples").and_then(|v| v.as_u64()).unwrap_or(120) as usize;

            let mut cfg = visualizer_cfg.write().await;
            cfg.enabled = enabled;
            cfg.mode = mode;
            cfg.fps = fps.clamp(1, 120);
            cfg.bands = bands.clamp(8, 256);
            cfg.waveform_samples = waveform_samples.clamp(16, 512);

            ok(&cmd.id, serde_json::json!({
                "enabled": cfg.enabled,
                "mode": mode_str,
                "fps": cfg.fps,
                "bands": cfg.bands,
                "waveformSamples": cfg.waveform_samples,
            }))
        }
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

    // Single multiplexed stdout channel so responses and events never
    // interleave or collide.
    let (stdout_tx, mut stdout_rx) = mpsc::channel::<String>(256);
    let writer_handle = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(line) = stdout_rx.recv().await {
            if let Err(e) = writeln_stdout(&mut stdout, &line).await {
                error!(error = %e, "stdout write error");
                break;
            }
        }
    });

    let playback = Playback::new(FakeEngine, stdout_tx.clone());
    let visualizer_cfg = Arc::new(tokio::sync::RwLock::new(visualizer::VisualizerConfig::default()));

    // Visualizer publisher: emits spectrum/waveform events at the
    // configured FPS. Synthesizes audio samples from a 440Hz + 1320Hz
    // harmonic while playing; emits zero-band frames while paused or
    // stopped so the TS side keeps a stable render target. Drops
    // frames silently if the stdout channel is full (audio path is
    // never blocked on visualizer traffic).
    let visualizer_publisher = playback.clone();
    let viz_cfg = visualizer_cfg.clone();
    let viz_stdout = stdout_tx.clone();
    let viz_handle = tokio::spawn(async move {
        let mut analyzer = visualizer::Analyzer::new(64);
        let mut seq: u64 = 1;
        let mut phase: f32 = 0.0;
        let sample_rate = 44100.0_f32;
        let mut last_tick = std::time::Instant::now();
        loop {
            let fps = viz_cfg.read().await.fps.max(1);
            let interval_ms = (1000_u64 / fps as u64).max(1);
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;

            let cfg = viz_cfg.read().await;
            if !cfg.enabled {
                continue;
            }
            let mode = cfg.mode;
            let bands = cfg.bands;
            let waveform_samples = cfg.waveform_samples;
            drop(cfg);
            analyzer.set_bands(bands);

            let snap = visualizer_publisher.snapshot().await;
            let samples = if snap.state == "playing" {
                let elapsed = last_tick.elapsed().as_secs_f32();
                last_tick = std::time::Instant::now();
                let n = 1024_usize;
                let mut samples = Vec::with_capacity(n);
                for i in 0..n {
                    let t = phase + (i as f32) / sample_rate + elapsed;
                    let s = 0.6 * (2.0 * std::f32::consts::PI * 440.0 * t).sin()
                          + 0.3 * (2.0 * std::f32::consts::PI * 1320.0 * t).sin();
                    samples.push(s);
                }
                phase = (phase + elapsed) % 1.0;
                samples
            } else {
                vec![0.0; 1024]
            };

            let line = match mode {
                visualizer::VisualizerMode::Oscilloscope => {
                    let downsampled = visualizer::Analyzer::compute_waveform(&samples, waveform_samples);
                    let payload = serde_json::json!({ "samples": downsampled });
                    event("visualizer.waveform", seq, payload)
                }
                _ => {
                    let bands = analyzer.compute_spectrum(&samples, mode);
                    let payload = serde_json::json!({ "bands": bands });
                    event("visualizer.spectrum", seq, payload)
                }
            };
            seq = seq.wrapping_add(1);
            let _ = viz_stdout.try_send(line);
        }
    });

    // Position ticker task: advances position while playing and emits
    // periodic position events.
    let ticker_playback = playback.clone();
    let ticker_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(50));
        loop {
            interval.tick().await;
            ticker_playback.tick().await;
        }
    });

    let stdin = tokio::io::stdin();
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
            let _ = stdout_tx
                .send(err(&c.id, ErrorBody::new(ErrorCode::InvalidRequest, "expected hello first")))
                .await;
            return ExitCode::from(2);
        }
        Err(e) => {
            error!(error = %e, "handshake parse failed");
            return ExitCode::from(2);
        }
    };

    let (hello_reply, _) = handle(hello_cmd, &auth, &playback, &visualizer_cfg).await;
    if let Err(e) = stdout_tx.send(hello_reply).await {
        error!(error = %e, "failed to queue hello reply");
        return ExitCode::from(2);
    }

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = shutdown_tx.send(()).await;
        }
    });

    let mut exit_code = ExitCode::SUCCESS;
    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("ctrl-c received; exiting");
                break;
            }
            line_res = lines.next_line() => {
                let line: String = match line_res {
                    Ok(Some(l)) => l,
                    Ok(None) => {
                        info!("stdin closed; exiting");
                        break;
                    }
                    Err(e) => {
                        error!(error = %e, "stdin read error");
                        exit_code = ExitCode::from(2);
                        break;
                    }
                };

                let (reply, should_exit) = match parse_command(&line) {
                    Ok(cmd) => handle(cmd, &auth, &playback, &visualizer_cfg).await,
                    Err(e) => {
                        warn!(error = %e, "command parse failed");
                        continue;
                    }
                };

                if let Err(e) = stdout_tx.send(reply).await {
                    error!(error = %e, "failed to queue reply");
                    exit_code = ExitCode::from(2);
                    break;
                }

                if should_exit {
                    info!("shutdown complete; exiting cleanly");
                    break;
                }
            }
        }
    }
    ticker_handle.abort();
    viz_handle.abort();
    drop(playback);
    drop(stdout_tx);
    let _ = writer_handle.await;
    exit_code
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
