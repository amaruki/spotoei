//! `spotoei` is a Spotify Connect player exposed as a TTY-friendly CLI. It
//! speaks a newline-delimited JSON protocol on stdin/stdout and serves a
//! `doctor` subcommand for environment diagnostics.
//!
//! Anything non-protocol on stdout is a protocol violation; logs go to stderr.

use std::process::ExitCode;

pub mod auth;
pub mod config;
pub mod dispatcher;
pub mod doctor;
pub mod logging;
pub mod lyrics;
pub mod playback;
pub mod protocol;
pub mod protocol_loop;
pub mod visualizer;
pub mod viz_task;

// Re-export protocol types and helpers used across the crate / externally.
pub use protocol::{
    event, next_event_seq, parse_command, Command, ErrorBody, ErrorCode, EventOut,
    ProtocolError, ResponseErr, ResponseOk, HANDSHAKE_TIMEOUT, MAX_ID_BYTES,
    MAX_LINE_BYTES, PLAYER_VERSION, PROTOCOL_STDOUT_CAP, PROTOCOL_VERSION,
    VIZ_STDOUT_CAP,
};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    logging::init_tracing();

    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "doctor" {
        return doctor::run_doctor(&args[2..]).await;
    }

    protocol_loop::run().await
}
