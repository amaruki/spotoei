//! macOS and Windows media controls via `souvlaki`.
//!
//! Neither platform has MPRIS. macOS delivers `MPRemoteCommandCenter` commands
//! through the `AppKit` run loop hosted on the main thread (`main.rs`); Windows
//! uses System Media Transport Controls, which need an HWND, so this module
//! runs a winit event loop with an invisible window on its own thread.

use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tracing::{info, warn};

use crate::playback::Playback;

const POLL_MS: u64 = 500;
const SEEK_STEP_MS: i64 = 10_000;

pub fn spawn(playback: Playback) {
    let spawned = std::thread::Builder::new()
        .name("spotoei-media".to_string())
        .spawn(move || run(playback));
    if let Err(e) = spawned {
        warn!("failed to spawn media control thread: {e}");
    }
}

#[cfg(target_os = "macos")]
fn run(playback: Playback) {
    let (tx, rx) = mpsc::channel::<MediaControlEvent>();
    let Some(mut controls) = new_controls(None) else {
        return;
    };
    if let Err(e) = controls.attach(move |event| {
        let _ = tx.send(event);
    }) {
        warn!("failed to attach media control events: {e}");
        return;
    }
    let Some(runtime) = media_runtime() else {
        return;
    };
    info!("macOS media controls registered");

    let mut last_track = None;
    loop {
        drain_events(&playback, &runtime, &rx);
        runtime.block_on(publish(&playback, &mut controls, &mut last_track));
        std::thread::sleep(Duration::from_millis(POLL_MS));
    }
}

#[cfg(target_os = "windows")]
fn run(playback: Playback) {
    use winit::platform::windows::EventLoopBuilderExtWindows;

    // winit requires the event loop on the main thread by default; Windows
    // supports any thread, which keeps the player's main loop untouched.
    let mut builder = winit::event_loop::EventLoop::builder();
    builder.with_any_thread(true);
    let event_loop = match builder.build() {
        Ok(event_loop) => event_loop,
        Err(e) => {
            warn!("media control event loop unavailable: {e}");
            return;
        }
    };
    let mut app = MediaApp::new(playback);
    if let Err(e) = event_loop.run_app(&mut app) {
        warn!("media control event loop stopped: {e}");
    }
}

#[cfg(target_os = "windows")]
struct MediaApp {
    playback: Playback,
    runtime: Option<tokio::runtime::Runtime>,
    controls: Option<MediaControls>,
    tx: mpsc::Sender<MediaControlEvent>,
    rx: Receiver<MediaControlEvent>,
    window: Option<winit::window::Window>,
    last_track: Option<String>,
}

#[cfg(target_os = "windows")]
impl MediaApp {
    fn new(playback: Playback) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            playback,
            runtime: None,
            controls: None,
            tx,
            rx,
            window: None,
            last_track: None,
        }
    }
}

#[cfg(target_os = "windows")]
impl winit::application::ApplicationHandler for MediaApp {
    fn resumed(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        if self.controls.is_some() {
            return;
        }
        let attributes = winit::window::Window::default_attributes()
            .with_visible(false)
            .with_title("Spotoei");
        let window = match event_loop.create_window(attributes) {
            Ok(window) => window,
            Err(e) => {
                warn!("failed to create media control window: {e}");
                event_loop.exit();
                return;
            }
        };
        let Some(mut controls) = new_controls(window_hwnd(&window)) else {
            event_loop.exit();
            return;
        };
        let tx = self.tx.clone();
        if let Err(e) = controls.attach(move |event| {
            let _ = tx.send(event);
        }) {
            warn!("failed to attach media control events: {e}");
            event_loop.exit();
            return;
        }
        let Some(runtime) = media_runtime() else {
            event_loop.exit();
            return;
        };
        self.runtime = Some(runtime);
        self.controls = Some(controls);
        self.window = Some(window);
        info!("Windows media controls registered");
    }

    fn window_event(
        &mut self,
        event_loop: &winit::event_loop::ActiveEventLoop,
        _window_id: winit::window::WindowId,
        event: winit::event::WindowEvent,
    ) {
        if matches!(
            event,
            winit::event::WindowEvent::CloseRequested | winit::event::WindowEvent::Destroyed
        ) {
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        if let (Some(runtime), Some(controls)) = (self.runtime.as_ref(), self.controls.as_mut()) {
            while let Ok(event) = self.rx.try_recv() {
                runtime.block_on(handle_event(&self.playback, event));
            }
            runtime.block_on(publish(&self.playback, controls, &mut self.last_track));
        }
        event_loop.set_control_flow(winit::event_loop::ControlFlow::WaitUntil(
            std::time::Instant::now() + Duration::from_millis(POLL_MS),
        ));
    }
}

#[cfg(target_os = "windows")]
fn window_hwnd(window: &winit::window::Window) -> Option<*mut std::ffi::c_void> {
    use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match window.window_handle().ok()?.as_raw() {
        RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as *mut std::ffi::c_void),
        _ => None,
    }
}

fn new_controls(hwnd: Option<*mut std::ffi::c_void>) -> Option<MediaControls> {
    let config = PlatformConfig {
        display_name: "Spotoei",
        dbus_name: "spotoei",
        hwnd,
    };
    match MediaControls::new(config) {
        Ok(controls) => Some(controls),
        Err(e) => {
            warn!("media controls unavailable: {e}");
            None
        }
    }
}

fn media_runtime() -> Option<tokio::runtime::Runtime> {
    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => Some(runtime),
        Err(e) => {
            warn!("media control runtime unavailable: {e}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn drain_events(
    playback: &Playback,
    runtime: &tokio::runtime::Runtime,
    rx: &Receiver<MediaControlEvent>,
) {
    while let Ok(event) = rx.try_recv() {
        runtime.block_on(handle_event(playback, event));
    }
}

async fn handle_event(playback: &Playback, event: MediaControlEvent) {
    let _ = match event {
        MediaControlEvent::Play => playback.play().await,
        MediaControlEvent::Pause => playback.pause().await,
        MediaControlEvent::Toggle => playback.toggle().await,
        MediaControlEvent::Next => playback.next().await,
        MediaControlEvent::Previous => playback.previous().await,
        MediaControlEvent::Stop => playback.pause().await,
        MediaControlEvent::Seek(direction) => {
            playback
                .seek_relative(seek_step(direction, SEEK_STEP_MS))
                .await
        }
        MediaControlEvent::SeekBy(direction, duration) => {
            let magnitude = i64::try_from(duration.as_millis()).unwrap_or(i64::MAX);
            playback
                .seek_relative(seek_step(direction, magnitude))
                .await
        }
        MediaControlEvent::SetPosition(MediaPosition(position)) => {
            playback.seek(position.as_millis() as u64).await
        }
        MediaControlEvent::SetVolume(volume) => playback.set_volume(volume as f32).await,
        _ => return,
    };
}

fn seek_step(direction: SeekDirection, magnitude: i64) -> i64 {
    match direction {
        SeekDirection::Forward => magnitude,
        SeekDirection::Backward => -magnitude,
    }
}

async fn publish(
    playback: &Playback,
    controls: &mut MediaControls,
    last_track: &mut Option<String>,
) {
    let snap = playback.snapshot().await;
    let progress = Some(MediaPosition(Duration::from_millis(snap.position_ms)));
    let playback_state = match snap.state.as_str() {
        "playing" | "loading" | "buffering" | "reconnecting" => MediaPlayback::Playing { progress },
        "paused" => MediaPlayback::Paused { progress },
        _ => MediaPlayback::Stopped,
    };
    let _ = controls.set_playback(playback_state);

    let Some(track) = snap.track.as_ref() else {
        return;
    };
    if last_track.as_deref() == Some(track.uri.as_str()) {
        return;
    }
    *last_track = Some(track.uri.clone());
    let artist = track.artists.join(", ");
    let _ = controls.set_metadata(MediaMetadata {
        title: Some(track.name.as_str()),
        album: track.album.as_deref(),
        artist: Some(artist.as_str()),
        cover_url: track.image_url.as_deref(),
        duration: (track.duration_ms > 0).then(|| Duration::from_millis(track.duration_ms)),
    });
}
