#![allow(clippy::large_futures)]
//! `spotoei` is a Spotify Connect player exposed as a TTY-friendly CLI. It
//! speaks a newline-delimited JSON protocol on stdin/stdout and serves a
//! `doctor` subcommand for environment diagnostics.

use std::process::ExitCode;

pub mod auth;
pub mod config;
pub mod dispatcher;
pub mod doctor;
pub mod logging;
pub mod lyrics;
pub mod media;
pub mod playback;
pub mod protocol;
pub mod protocol_loop;
pub mod visualizer;
pub mod viz_task;

// Re-export protocol types and helpers used across the crate / externally.
pub use protocol::{
    event, next_event_seq, parse_command, Command, ErrorBody, ErrorCode, EventOut, ProtocolError,
    ResponseErr, ResponseOk, HANDSHAKE_TIMEOUT, MAX_ID_BYTES, MAX_LINE_BYTES, PLAYER_VERSION,
    PROTOCOL_STDOUT_CAP, PROTOCOL_VERSION, VIZ_STDOUT_CAP,
};

fn main() -> ExitCode {
    logging::init_tracing();
    let args: Vec<String> = std::env::args().collect();
    #[cfg(target_os = "macos")]
    {
        run_macos(args)
    }
    #[cfg(not(target_os = "macos"))]
    {
        runtime().block_on(run_args(args))
    }
}

async fn run_args(args: Vec<String>) -> ExitCode {
    if args.len() >= 2 && args[1] == "doctor" {
        return doctor::run_doctor(&args[2..]).await;
    }
    if args.len() >= 2 && args[1] == "logout" {
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
        let auth = auth::AuthManager::new(config::resolve_client_id(), tx);
        let _ = auth.hydrate().await;
        let _ = auth.logout().await;
        println!("Logged out successfully. Keyring and session cleared.");
        return ExitCode::SUCCESS;
    }

    protocol_loop::run().await
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build the tokio runtime")
}

/// macOS delivers media key commands through the `AppKit` run loop, which must
/// run on the main thread. Keep the protocol loop on its own thread and exit
/// the event loop once the player loop finishes.
#[cfg(target_os = "macos")]
fn run_macos(args: Vec<String>) -> ExitCode {
    use std::sync::{Arc, Mutex};

    if args.len() >= 2 && (args[1] == "doctor" || args[1] == "logout") {
        return runtime().block_on(run_args(args));
    }

    let exit_code = Arc::new(Mutex::new(ExitCode::SUCCESS));
    let exit_for_thread = Arc::clone(&exit_code);
    let protocol = std::thread::Builder::new()
        .name("spotoei-protocol".to_string())
        .spawn(move || {
            let code = runtime().block_on(run_args(args));
            if let Ok(mut slot) = exit_for_thread.lock() {
                *slot = code;
            }
        })
        .expect("failed to spawn protocol thread");

    use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};

    let mut builder = winit::event_loop::EventLoop::builder();
    // Accessory keeps the player out of the Dock and menubar while still
    // providing the run loop that delivers media key commands.
    builder.with_activation_policy(ActivationPolicy::Accessory);
    let event_loop = match builder.build() {
        Ok(event_loop) => event_loop,
        Err(e) => {
            eprintln!("failed to start the macOS event loop: {e}");
            let _ = protocol.join();
            return ExitCode::FAILURE;
        }
    };
    let proxy = event_loop.create_proxy();
    std::thread::spawn(move || {
        let _ = protocol.join();
        let _ = proxy.send_event(());
    });

    struct ExitOnProtocolEnd;
    impl winit::application::ApplicationHandler for ExitOnProtocolEnd {
        fn resumed(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop) {}
        fn user_event(&mut self, event_loop: &winit::event_loop::ActiveEventLoop, _event: ()) {
            event_loop.exit();
        }
        fn window_event(
            &mut self,
            _event_loop: &winit::event_loop::ActiveEventLoop,
            _window_id: winit::window::WindowId,
            _event: winit::event::WindowEvent,
        ) {
        }
    }

    if let Err(e) = event_loop.run_app(&mut ExitOnProtocolEnd) {
        eprintln!("macOS event loop stopped: {e}");
    }
    exit_code
        .lock()
        .map(|code| *code)
        .unwrap_or(ExitCode::FAILURE)
}
