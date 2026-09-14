//! Playback Core.
//!
//! Wraps a `PlaybackEngine` (fake/librespot) behind a state machine
//! and produces the `playback.changed` / `playback.position` events consumed
//! by the TUI. No librespot internals leak out of the player process; the
//! surface is the wire schema only.
mod engine;
mod librespot;
mod settings_cmd;
mod state;
mod tick;
mod transport_cmd;
mod types;

// Public re-exports to preserve the existing public API surface.
pub use engine::{FakeEngine, PlaybackEngine};
pub use librespot::{DummySink, LibrespotActive, LibrespotEngine, VisualizerSink};
pub use state::{format_playback_changed_event, format_playback_position_event, Playback};
pub use types::{
    AudioBackend, Bitrate, DeviceMode, LibrespotConfig, LoadRequest, PlaybackChangedPayload,
    PlaybackError, PlaybackInner, PlaybackState, RepeatMode, Track,
};

#[cfg(test)]
mod tests;
