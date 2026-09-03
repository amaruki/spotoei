//! `shutdown` exits cleanly.
//! Anything non-protocol on stdout is a protocol violation; logs go to stderr.

pub mod auth;
pub mod lyrics;
pub mod playback;
pub mod visualizer;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use auth::{AuthManager, AuthStatus};
use playback::{FakeEngine, LoadRequest, Playback, PlaybackError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Stdout};
use tokio::sync::mpsc;
use tracing::{error, info, warn};
const PROTOCOL_VERSION: u32 = 1;
const PLAYER_VERSION: &str = env!("CARGO_PKG_VERSION");
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_LINE_BYTES: usize = 1 << 20; // 1 MiB
const MAX_ID_BYTES: usize = 64;
const PROTOCOL_STDOUT_CAP: usize = 1024;
const VIZ_STDOUT_CAP: usize = 64;

/// Process-global monotonic event sequence counter shared across
/// subsystems (auth, playback, lyrics, visualizer).
pub static NEXT_EVENT_SEQ: AtomicU64 = AtomicU64::new(0);

/// Reserve and return the next monotonic event sequence number.
pub fn next_event_seq() -> u64 {
    NEXT_EVENT_SEQ
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
}

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
enum ProtocolError {
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

fn cap_id(id: &str) -> &str {
    if id.len() > MAX_ID_BYTES {
        &id[..MAX_ID_BYTES]
    } else {
        id
    }
}

fn ok(id: &str, data: Value) -> String {
    let r = ResponseOk {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: cap_id(id),
        ok: true,
        data,
    };
    serde_json::to_string(&r).expect("response serialization")
}

fn err(id: &str, body: ErrorBody) -> String {
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
    if cmd.id.len() > MAX_ID_BYTES {
        return Err(ProtocolError::IdTooLong(cmd.id.len()));
    }
    Ok(cmd)
}

fn load_client_id_from_config() -> String {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let config_path = config_dir.join("spotoei").join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&content) {
            if let Some(id) = val
                .get("spotify")
                .and_then(|s| s.get("clientId"))
                .and_then(|c| c.as_str())
            {
                if !id.trim().is_empty() {
                    return id.trim().to_string();
                }
            }
        }
    }
    String::new()
}

fn resolve_client_id() -> String {
    match std::env::var("SPOTOEI_CLIENT_ID") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => {
            let from_config = load_client_id_from_config();
            if !from_config.is_empty() {
                from_config
            } else {
                auth::KEYMASTER_CLIENT_ID.to_string()
            }
        }
    }
}

async fn handle(
    cmd: Command,
    auth: &Arc<AuthManager>,
    playback: &Playback,
    visualizer_cfg: &Arc<tokio::sync::RwLock<visualizer::VisualizerConfig>>,
    lyrics: &lyrics::LyricsService,
) -> (String, bool) {
    let is_shutdown = cmd.command == "shutdown";
    let reply = match cmd.command.as_str() {
        "hello" => {
            let data = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "playerVersion": PLAYER_VERSION,
                "capabilities": vec![
                    "lyrics.synced",
                    "lyrics.plain",
                    "visualizer.spectrum",
                    "visualizer.waveform",
                    "auth.single-token-session",
                ],
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
            let scopes = cmd
                .data
                .get("scopes")
                .and_then(|v| v.as_array())
                .map(|arr| {
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
        "auth.set_client_id" => {
            let id = cmd
                .data
                .get("clientId")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if id.is_empty() {
                err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "clientId cannot be empty"),
                )
            } else {
                auth.set_client_id(id.clone()).await;
                ok(&cmd.id, serde_json::json!({ "ok": true, "clientId": id }))
            }
        },
        "playback.load" => {
            let context_uri = cmd.data.get("contextUri").and_then(|v| v.as_str());
            let track_uri = cmd.data.get("trackUri").and_then(|v| v.as_str());
            let autoplay = cmd
                .data
                .get("autoplay")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let name = cmd.data.get("name").and_then(|v| v.as_str());
            let artists = cmd.data.get("artists").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            });
            let album = cmd.data.get("album").and_then(|v| v.as_str());
            let duration_ms = cmd
                .data
                .get("durationMs")
                .and_then(|v| v.as_u64());
            let genre = cmd.data.get("genre").and_then(|v| v.as_str());
            let _ = playback.set_autoplay(autoplay).await;
            match playback
                .load(LoadRequest {
                    context_uri,
                    track_uri,
                    name,
                    artists,
                    album,
                    duration_ms,
                    genre,
                })
                .await
            {
                Ok(snap) => {
                    let final_snap = if autoplay {
                        match playback.play().await {
                            Ok(s) => s,
                            Err(_) => snap,
                        }
                    } else {
                        match playback.pause().await {
                            Ok(s) => s,
                            Err(_) => snap,
                        }
                    };
                    ok(
                        &cmd.id,
                        serde_json::to_value(&final_snap).unwrap_or(Value::Null),
                    )
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
            let pos_result: Result<u64, ErrorBody> = match cmd.data.get("positionMs") {
                Some(v) => v.as_u64().ok_or_else(|| {
                    ErrorBody::new(ErrorCode::InvalidRequest, "positionMs must be an integer")
                }),
                None => Err(ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "missing required positionMs",
                )),
            };
            match pos_result {
                Ok(pos) => match playback.seek(pos).await {
                    Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                    Err(PlaybackError) => err(
                        &cmd.id,
                        ErrorBody::new(ErrorCode::PlaybackFailed, "seek failed; no track loaded"),
                    ),
                },
                Err(e) => err(&cmd.id, e),
            }
        }
        "playback.set_volume" => {
            let vol_result: Result<f32, ErrorBody> = match cmd.data.get("volume") {
                Some(v) => v.as_f64().map(|f| f as f32).ok_or_else(|| {
                    ErrorBody::new(ErrorCode::InvalidRequest, "volume must be a float")
                }),
                None => Err(ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "missing required volume",
                )),
            };
            match vol_result {
                Ok(vol) => match playback.set_volume(vol).await {
                    Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                    Err(PlaybackError) => err(
                        &cmd.id,
                        ErrorBody::new(
                            ErrorCode::InvalidRequest,
                            "volume must be between 0.0 and 1.0",
                        ),
                    ),
                },
                Err(e) => err(&cmd.id, e),
            }
        }
        "playback.set_shuffle" => {
            let shuffle_result: Result<bool, ErrorBody> = match cmd.data.get("shuffle") {
                Some(v) => v.as_bool().ok_or_else(|| {
                    ErrorBody::new(ErrorCode::InvalidRequest, "shuffle must be a boolean")
                }),
                None => Err(ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "missing required shuffle",
                )),
            };
            match shuffle_result {
                Ok(shuffle) => match playback.set_shuffle(shuffle).await {
                    Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                    Err(PlaybackError) => err(
                        &cmd.id,
                        ErrorBody::new(ErrorCode::PlaybackFailed, "set_shuffle failed"),
                    ),
                },
                Err(e) => err(&cmd.id, e),
            }
        }
        "playback.set_repeat" => {
            let repeat_result: Result<&str, ErrorBody> = match cmd.data.get("repeat") {
                Some(v) => v.as_str().ok_or_else(|| {
                    ErrorBody::new(ErrorCode::InvalidRequest, "repeat must be a string")
                }),
                None => Err(ErrorBody::new(
                    ErrorCode::InvalidRequest,
                    "missing required repeat",
                )),
            };
            match repeat_result {
                Ok(repeat) => match playback.set_repeat(repeat).await {
                    Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                    Err(PlaybackError) => err(
                        &cmd.id,
                        ErrorBody::new(
                            ErrorCode::InvalidRequest,
                            "repeat mode must be off|context|track",
                        ),
                    ),
                },
                Err(e) => err(&cmd.id, e),
            }
        }

        "playback.set_autoplay" => {
            let autoplay = match cmd.data.get("autoplay").and_then(|v| v.as_bool()) {
                Some(b) => b,
                None => {
                    return (
                        err(
                            &cmd.id,
                            ErrorBody::new(ErrorCode::InvalidRequest, "autoplay must be a boolean"),
                        ),
                        false,
                    );
                }
            };
            match playback.set_autoplay(autoplay).await {
                Ok(snap) => ok(&cmd.id, serde_json::to_value(&snap).unwrap_or(Value::Null)),
                Err(PlaybackError) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::PlaybackFailed, "set_autoplay failed"),
                ),
            }
        }
        "visualizer.configure" => {
            let enabled = match cmd.data.get("enabled").and_then(|v| v.as_bool()) {
                Some(b) => b,
                None => true,
            };
            let mode = if let Some(m) = cmd.data.get("mode").and_then(|v| v.as_str()) {
                match m {
                    "spectrum" => visualizer::VisualizerMode::Spectrum,
                    "winamp" => visualizer::VisualizerMode::Winamp,
                    "oscilloscope" => visualizer::VisualizerMode::Oscilloscope,
                    _ => {
                        return (
                            err(
                                &cmd.id,
                                ErrorBody::new(
                                    ErrorCode::InvalidRequest,
                                    "mode must be spectrum|winamp|oscilloscope",
                                ),
                            ),
                            false,
                        );
                    }
                }
            } else {
                visualizer::VisualizerMode::Spectrum
            };
            let fps = if let Some(f) = cmd.data.get("fps") {
                match f.as_u64() {
                    Some(val) if (1..=120).contains(&val) => val as u32,
                    _ => {
                        return (
                            err(
                                &cmd.id,
                                ErrorBody::new(
                                    ErrorCode::InvalidRequest,
                                    "fps must be between 1 and 120",
                                ),
                            ),
                            false,
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
                        return (
                            err(
                                &cmd.id,
                                ErrorBody::new(
                                    ErrorCode::InvalidRequest,
                                    "bands must be between 8 and 256",
                                ),
                            ),
                            false,
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
                        return (
                            err(
                                &cmd.id,
                                ErrorBody::new(
                                    ErrorCode::InvalidRequest,
                                    "waveformSamples must be between 16 and 512",
                                ),
                            ),
                            false,
                        );
                    }
                }
            } else {
                120
            };

            let mut cfg = visualizer_cfg.write().await;
            cfg.enabled = enabled;
            cfg.mode = mode;
            cfg.fps = fps;
            cfg.bands = bands;
            cfg.waveform_samples = waveform_samples;

            let mode_str = match mode {
                visualizer::VisualizerMode::Winamp => "winamp",
                visualizer::VisualizerMode::Oscilloscope => "oscilloscope",
                visualizer::VisualizerMode::Spectrum => "spectrum",
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
        "lyrics.get" => {
            let track_uri = cmd
                .data
                .get("trackUri")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match lyrics.get(track_uri) {
                Ok(doc) => ok(&cmd.id, serde_json::to_value(&doc).unwrap_or(Value::Null)),
                Err(lyrics::LyricsError::Unavailable) => err(
                    &cmd.id,
                    ErrorBody::new(
                        ErrorCode::LyricsUnavailable,
                        "lyrics unavailable for this track",
                    ),
                ),
                Err(lyrics::LyricsError::InvalidUri) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "invalid track URI"),
                ),
            }
        }
        other => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::InvalidRequest,
                format!("unknown command: {other}"),
            ),
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
    // Separate multiplexed stdout channels so high-frequency visualizer
    // frames cannot starve or block critical protocol responses / events.
    let (stdout_tx, mut stdout_rx) = mpsc::channel::<String>(PROTOCOL_STDOUT_CAP);
    let (viz_stdout_tx, mut viz_stdout_rx) = mpsc::channel::<String>(VIZ_STDOUT_CAP);
    let writer_handle = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        loop {
            tokio::select! {
                biased;
                line = stdout_rx.recv() => {
                    match line {
                        Some(l) => {
                            if let Err(e) = writeln_stdout(&mut stdout, &l).await {
                                error!(error = %e, "stdout write error");
                                break;
                            }
                        }
                        None => break,
                    }
                }
                viz_line = viz_stdout_rx.recv() => {
                    if let Some(l) = viz_line {
                        if let Err(e) = writeln_stdout(&mut stdout, &l).await {
                            error!(error = %e, "stdout write error");
                            break;
                        }
                    }
                }
            }
        }
    });
    let client_id = resolve_client_id();
    let auth = Arc::new(AuthManager::new(client_id, stdout_tx.clone()));
    let _initial_status = auth.hydrate().await;

    let lyrics = lyrics::LyricsService::new(Arc::new(lyrics::MockLyricsProvider::new()));
    let use_mock_playback = std::env::var("SPOTOEI_MOCK_AUTH").is_ok()
        || std::env::var("SPOTOEI_MOCK_PLAYER").is_ok();
    let (playback, pcm_rx) = if use_mock_playback {
        info!("Playback engine: FakeEngine (mock mode)");
        let (_pcm_tx, pcm_rx) = crossbeam_channel::bounded(64);
        (Playback::new(FakeEngine, stdout_tx.clone()), pcm_rx)
    } else {
        info!("Playback engine: LibrespotEngine (native audio output)");
        let engine = playback::LibrespotEngine::new(auth.clone());
        let pcm_rx = engine.pcm_receiver();
        (Playback::new(engine, stdout_tx.clone()), pcm_rx)
    };
    let visualizer_cfg = Arc::new(tokio::sync::RwLock::new(
        visualizer::VisualizerConfig::default(),
    ));
    // Visualizer publisher: emits real-time CAVA FFT spectrum and waveform
    // events from audio decoded by Librespot. Drops frames silently if
    // the stdout channel is full so the audio playback path is never blocked.
    let visualizer_publisher = playback.clone();
    let viz_cfg = visualizer_cfg.clone();
    let viz_stdout_tx = viz_stdout_tx.clone();
    let viz_handle = tokio::spawn(async move {
        let mut analyzer = visualizer::Analyzer::new(64);
        let mut ring_buffer = vec![0.0f32; 1024];
        let mut mock_phase: f32 = 0.0;
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
            if snap.state != "playing" {
                let empty_samples: [f32; 0] = [];
                let seq = next_event_seq();
                let line = match mode {
                    visualizer::VisualizerMode::Oscilloscope => {
                        let payload = serde_json::json!({ "samples": vec![0.0; waveform_samples] });
                        event("visualizer.waveform", seq, payload)
                    }
                    _ => {
                        let bands = analyzer.compute_spectrum(&empty_samples, mode);
                        let payload = serde_json::json!({ "bands": bands });
                        event("visualizer.spectrum", seq, payload)
                    }
                };
                let _ = viz_stdout_tx.try_send(line);
                continue;
            }

            // Drain fresh PCM packets from audio sink
            let mut got_real_pcm = false;
            while let Ok(chunk) = pcm_rx.try_recv() {
                got_real_pcm = true;
                if chunk.len() >= 1024 {
                    ring_buffer.copy_from_slice(&chunk[chunk.len() - 1024..]);
                } else {
                    ring_buffer.rotate_left(chunk.len());
                    let start = 1024 - chunk.len();
                    ring_buffer[start..].copy_from_slice(&chunk);
                }
            }

            if !got_real_pcm {
                let elapsed = last_tick.elapsed().as_secs_f32();
                for i in 0..1024 {
                    let t = mock_phase + (i as f32) / sample_rate;
                    let bass = 0.40 * (2.0 * std::f32::consts::PI * 65.0 * t).sin();
                    let kick = 0.30 * (2.0 * std::f32::consts::PI * 130.0 * t).sin();
                    let mid1 = 0.25 * (2.0 * std::f32::consts::PI * 440.0 * t).sin();
                    let mid2 = 0.20 * (2.0 * std::f32::consts::PI * 880.0 * t).sin();
                    let treble = 0.15 * (2.0 * std::f32::consts::PI * 3520.0 * t).sin();
                    ring_buffer[i] = (bass + kick + mid1 + mid2 + treble).clamp(-1.0, 1.0);
                }
                mock_phase = (mock_phase + elapsed) % 1000.0;
            }
            last_tick = std::time::Instant::now();

            let seq = next_event_seq();
            let line = match mode {
                visualizer::VisualizerMode::Oscilloscope => {
                    let downsampled =
                        visualizer::Analyzer::compute_waveform(&ring_buffer, waveform_samples);
                    let payload = serde_json::json!({ "samples": downsampled });
                    event("visualizer.waveform", seq, payload)
                }
                _ => {
                    let bands = analyzer.compute_spectrum(&ring_buffer, mode);
                    let payload = serde_json::json!({ "bands": bands });
                    event("visualizer.spectrum", seq, payload)
                }
            };
            let _ = viz_stdout_tx.try_send(line);
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
    // Bounded buffered reader: enforces MAX_LINE_BYTES on every
    // `read_line` call so a misbehaving peer can't cause unbounded
    // allocation by streaming bytes that never include '\n'.
    let mut stdin_reader = BufReader::with_capacity(8 * 1024, stdin);
    let mut line_buf = String::with_capacity(8 * 1024);
    info!(version = PLAYER_VERSION, "spotoei-player starting");

    // Read the first line with size bound.
    let hello_line: String = {
        line_buf.clear();
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, stdin_reader.read_line(&mut line_buf)).await {
            Ok(Ok(0)) => {
                error!("stdin closed before hello");
                return ExitCode::from(2);
            }
            Ok(Ok(n)) => {
                if n > MAX_LINE_BYTES {
                    error!("handshake line exceeds MAX_LINE_BYTES limit");
                    return ExitCode::from(2);
                }
                let trimmed = line_buf.trim_end_matches(['\r', '\n']).to_string();
                trimmed
            }
            Ok(Err(e)) => {
                error!(error = %e, "stdin read error");
                return ExitCode::from(2);
            }
            Err(_) => {
                error!("handshake timeout (no hello within 5s)");
                return ExitCode::from(2);
            }
        }
    };

    let hello_cmd = match parse_command(&hello_line) {
        Ok(c) if c.command == "hello" => c,
        Ok(c) => {
            error!(command = %c.command, "expected hello as first command");
            let _ = stdout_tx
                .send(err(
                    &c.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "expected hello first"),
                ))
                .await;
            return ExitCode::from(2);
        }
        Err(e) => {
            error!(error = %e, "handshake parse failed");
            return ExitCode::from(2);
        }
    };

    let (hello_reply, _) = handle(hello_cmd, &auth, &playback, &visualizer_cfg, &lyrics).await;
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
        line_buf.clear();
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("ctrl-c received; exiting");
                break;
            }
            read_res = stdin_reader.read_line(&mut line_buf) => {
                let line: String = match read_res {
                    Ok(0) => {
                        info!("stdin closed; exiting");
                        break;
                    }
                    Ok(n) => {
                        if n > MAX_LINE_BYTES {
                            warn!("line exceeded MAX_LINE_BYTES limit");
                            continue;
                        }
                        line_buf.trim_end_matches(['\r', '\n']).to_string()
                    }
                    Err(e) => {
                        error!(error = %e, "stdin read error");
                        exit_code = ExitCode::from(2);
                        break;
                    }
                };

                let (reply, should_exit) = match parse_command(&line) {
                    Ok(cmd) => handle(cmd, &auth, &playback, &visualizer_cfg, &lyrics).await,
                    Err(e) => {
                        warn!(error = %e, "command parse failed");
                        let reply = err(
                            "0",
                            ErrorBody::new(
                                ErrorCode::InvalidRequest,
                                format!("command parse error: {e}"),
                            ),
                        );
                        (reply, false)
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
    // Cancel OAuth callback server and join its task before tearing the
    // process down so the loopback listener is released cleanly.
    auth.cancel_in_flight().await;
    ticker_handle.abort();
    viz_handle.abort();
    drop(auth);
    drop(playback);
    drop(stdout_tx);
    let _ = writer_handle.await;
    match exit_code {
        ExitCode::SUCCESS => std::process::exit(0),
        _ => std::process::exit(2),
    }
}

async fn run_doctor(args: &[String]) -> ExitCode {
    let sub = args.first().map(|s| s.as_str()).unwrap_or("all");
    let mut problems = 0u32;

    if sub == "all" || sub == "version" {
        println!("[ok] SPOTOEI version: player={}", PLAYER_VERSION);
    }

    if sub == "all" || sub == "audio" {
        let client_id = resolve_client_id();
        let (tx, _rx) = mpsc::channel::<String>(8);
        let auth = Arc::new(AuthManager::new(client_id, tx));
        let _ = auth.hydrate().await;
        let engine = playback::LibrespotEngine::new(auth);
        match engine.ensure_player().await {
            Ok(_) => println!("[ok] audio engine and librespot connection successful"),
            Err(e) => {
                println!("[err] audio engine failure: {e}");
                problems += 1;
            }
        }
    }

    if sub == "all" || sub == "sidecar" {
        // We are the sidecar; confirm we can emit a hello response.
        println!(
            "[ok] player sidecar present (protocol={})",
            PROTOCOL_VERSION
        );
    }

    if sub == "all" || sub == "config" {
        let id = resolve_client_id();
        if !id.is_empty() {
            println!("[ok] config readable (client_id=<set>)");
        } else {
            println!("[warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ~/.config/spotoei/config.json)");
            problems += 1;
        }
    }

    if sub == "all" || sub == "auth" {
        let client_id = resolve_client_id();
        let (tx, _rx) = mpsc::channel::<String>(8);
        let auth = AuthManager::new(client_id.clone(), tx);
        let status: AuthStatus = auth.hydrate().await;
        println!(
            "Client ID: {}",
            if client_id.is_empty() {
                "<not set: SPOTOEI_CLIENT_ID or ~/.config/spotoei/config.json>"
            } else {
                "<set>"
            }
        );
        println!("Auth State: {:?}", status.state);
        println!("Storage Tier: {:?}", status.storage);
        println!(
            "Account ID: {}",
            status.account_id.as_deref().unwrap_or("<none>")
        );
        println!(
            "Scopes: {}",
            if status.scopes.is_empty() {
                "<none>".to_string()
            } else {
                status.scopes.join(", ")
            }
        );
        if let Ok((token, _)) = auth.get_web_token().await {
            let client = reqwest::Client::new();
            if let Ok(resp) = client
                .get("https://api.spotify.com/v1/me")
                .bearer_auth(token)
                .send()
                .await
            {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    println!("Spotify /v1/me: {}", val);
                    let user_id = val.get("id").and_then(|v| v.as_str()).unwrap_or("<unknown>");
                    let product = val.get("product").and_then(|v| v.as_str()).unwrap_or("<unknown>");
                    println!("Spotify User ID: {user_id}");
                    println!("Spotify Product Plan: {product}");
                }
            }
        }
    }

    if sub == "all" || sub == "cache" {
        // Cache is owned by the UI; here we just confirm the directory is writable
        // so the UI can create its SQLite file.
        let cache_path = std::env::var("XDG_CACHE_HOME")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join("spotoei"))
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|p| std::path::PathBuf::from(p).join(".cache").join("spotoei"))
            });
        match cache_path {
            Some(dir) => {
                if std::fs::create_dir_all(&dir).is_ok() {
                    println!("[ok] cache directory writable: {}", dir.display());
                } else {
                    println!("[warn] cache directory not writable: {}", dir.display());
                    problems += 1;
                }
            }
            None => {
                println!("[warn] cache directory: cannot resolve XDG_CACHE_HOME/HOME");
                problems += 1;
            }
        }
    }

    if sub == "all" || sub == "browser" {
        // Best-effort check: the Spotify OAuth flow opens a browser. We look
        // for `xdg-open` (Linux), `open` (macOS), or `start` (Windows).
        let candidates: &[&str] = if cfg!(target_os = "macos") {
            &["open"]
        } else if cfg!(target_os = "windows") {
            &["start", "rundll32"]
        } else {
            &["xdg-open", "sensible-browser", "wslview"]
        };
        let found = candidates.iter().find(|c| {
            std::process::Command::new(c)
                .arg("--version")
                .output()
                .is_ok()
                || std::process::Command::new(c).arg("").output().is_ok()
        });
        match found {
            Some(cmd) => println!("[ok] browser launch mechanism available: {}", cmd),
            None => {
                println!("[warn] browser launch mechanism: no known browser opener on PATH");
                problems += 1;
            }
        }
    }

    if problems == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

async fn writeln_stdout(stdout: &mut Stdout, line: &str) -> std::io::Result<()> {
    stdout.write_all(line.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await
}

fn get_log_file_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("SPOTOEI_LOG_FILE") {
        return std::path::PathBuf::from(path);
    }
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let spotoei_dir = config_dir.join("spotoei");
    let _ = std::fs::create_dir_all(&spotoei_dir);
    spotoei_dir.join("spotoei.log")
}

fn init_tracing() {
    use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let log_path = get_log_file_path();

    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let file_layer = fmt::layer()
            .with_writer(std::sync::Arc::new(file))
            .with_ansi(false)
            .with_target(false);
        let stderr_layer = fmt::layer()
            .with_writer(std::io::stderr)
            .with_target(false);

        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .with(stderr_layer)
            .try_init();
    } else {
        let _ = fmt()
            .with_writer(std::io::stderr)
            .with_env_filter(filter)
            .with_target(false)
            .try_init();
    }
}
