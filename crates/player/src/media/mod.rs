//! OS media controls.
//!
//! A TUI cannot receive global media keys directly, so each platform needs a
//! native integration:
//!
//! - Linux: MPRIS D-Bus (`souvlaki`-independent implementation), which desktop
//!   environments and `WirePlumber` use for Bluetooth headset AVRCP buttons.
//! - macOS: `MPRemoteCommandCenter`/`MPNowPlayingInfoCenter`, delivered through
//!   the `AppKit` run loop that `main.rs` hosts on the main thread.
//! - Windows: System Media Transport Controls, which require an HWND and a
//!   message pump (an invisible winit window in a dedicated thread).

#[cfg(target_os = "linux")]
mod mpris;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod souvlaki;

use crate::playback::Playback;

/// Start OS media controls on a dedicated thread. Best effort: unsupported or
/// headless sessions log and keep playing without them.
pub fn spawn(playback: Playback) {
    #[cfg(target_os = "linux")]
    mpris::spawn(playback);
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    souvlaki::spawn(playback);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let _ = playback;
}
