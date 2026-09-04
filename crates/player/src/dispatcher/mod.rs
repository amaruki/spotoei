use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth::AuthManager;
use crate::lyrics::LyricsService;
use crate::playback::Playback;
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode, PLAYER_VERSION, PROTOCOL_VERSION};
use crate::visualizer::VisualizerConfig;

pub mod auth_cmd;
pub mod lyrics_cmd;
pub mod playback_cmd;
pub mod visualizer_cmd;

pub async fn handle(
    cmd: Command,
    auth: &Arc<AuthManager>,
    playback: &Playback,
    visualizer_cfg: &Arc<RwLock<VisualizerConfig>>,
    lyrics: &LyricsService,
) -> (String, bool) {
    let is_shutdown = cmd.command == "shutdown";
    let reply = match cmd.command.as_str() {
        "hello" => hello(&cmd),
        "shutdown" => ok(&cmd.id, serde_json::json!({})),
        "player.status" => player_status(&cmd, playback).await,
        command if command.starts_with("auth.") => auth_cmd::dispatch(command, &cmd, auth).await,
        command if command.starts_with("playback.") => {
            playback_cmd::dispatch(command, &cmd, playback).await
        }
        "visualizer.configure" => visualizer_cmd::configure(&cmd, visualizer_cfg).await,
        "lyrics.get" => lyrics_cmd::get(&cmd, lyrics),
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

fn hello(cmd: &Command) -> String {
    const SUPPORTED: [u32; 1] = [PROTOCOL_VERSION];
    let client_protocols: Option<Vec<u32>> = cmd
        .data
        .get("protocols")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u32)).collect());
    let has_overlap = match &client_protocols {
        Some(protos) => protos.iter().any(|p| SUPPORTED.contains(p)),
        None => false,
    };
    if !has_overlap {
        return err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::Unsupported,
                format!("unsupported protocol: expected one of {SUPPORTED:?}, got {client_protocols:?}"),
            ),
        );
    }
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

async fn player_status(cmd: &Command, playback: &Playback) -> String {
    let snap = playback.snapshot().await;
    ok(
        &cmd.id,
        serde_json::to_value(&snap).unwrap_or(serde_json::Value::Null),
    )
}
