use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::auth::AuthManager;
use crate::dispatcher::handle;
use crate::lyrics::LyricsService;
use crate::playback::Playback;
use crate::protocol::{
    err, parse_command, ErrorBody, ErrorCode, HANDSHAKE_TIMEOUT, MAX_LINE_BYTES, PLAYER_VERSION,
};
use crate::visualizer::VisualizerConfig;

pub async fn run() -> ExitCode {
    // Separate multiplexed stdout channels so high-frequency visualizer
    // frames cannot starve or block critical protocol responses / events.
    let (stdout_tx, mut stdout_rx) = mpsc::channel::<String>(
        crate::protocol::PROTOCOL_STDOUT_CAP,
    );
    let (viz_stdout_tx, mut viz_stdout_rx) = mpsc::channel::<String>(
        crate::protocol::VIZ_STDOUT_CAP,
    );
    let writer_handle = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        loop {
            tokio::select! {
                biased;
                line = stdout_rx.recv() => {
                    match line {
                        Some(l) => {
                            if let Err(e) = crate::logging::writeln_stdout(&mut stdout, &l).await {
                                error!(error = %e, "stdout write error");
                                break;
                            }
                        }
                        None => break,
                    }
                }
                viz_line = viz_stdout_rx.recv() => {
                    if let Some(l) = viz_line {
                        if let Err(e) = crate::logging::writeln_stdout(&mut stdout, &l).await {
                            error!(error = %e, "stdout write error");
                            break;
                        }
                    }
                }
            }
        }
    });
    let client_id = crate::config::resolve_client_id();
    let auth = Arc::new(AuthManager::new(client_id, stdout_tx.clone()));
    let _initial_status = auth.hydrate().await;

    let lyrics = LyricsService::new(Arc::new(crate::lyrics::MockLyricsProvider::new()));
    let use_mock_playback = std::env::var("SPOTOEI_MOCK_AUTH").is_ok()
        || std::env::var("SPOTOEI_MOCK_PLAYER").is_ok();
    let (playback, pcm_rx) = if use_mock_playback {
        info!("Playback engine: FakeEngine (mock mode)");
        let (_pcm_tx, pcm_rx) = crossbeam_channel::bounded(64);
        (
            Playback::new(crate::playback::FakeEngine, stdout_tx.clone()),
            pcm_rx,
        )
    } else {
        info!("Playback engine: LibrespotEngine (native audio output)");
        let engine = crate::playback::LibrespotEngine::new(auth.clone());
        let pcm_rx = engine.pcm_receiver();
        (Playback::new(engine, stdout_tx.clone()), pcm_rx)
    };
    let visualizer_cfg = Arc::new(RwLock::new(VisualizerConfig::default()));
    // Visualizer publisher: emits real-time CAVA FFT spectrum and waveform
    // events from audio decoded by Librespot. Drops frames silently if
    // the stdout channel is full so the audio playback path is never blocked.
    let viz_handle =
        crate::viz_task::spawn_visualizer_task(playback.clone(), pcm_rx, visualizer_cfg.clone(), viz_stdout_tx.clone());
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
