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
pub use librespot::{LibrespotEngine, VisualizerSink};
pub use state::Playback;
pub use types::{
    LoadRequest, PlaybackChangedPayload, PlaybackError, PlaybackInner, PlaybackState, RepeatMode,
    Track,
};

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_playback_fake_engine_lifecycle() {
        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        // Initial state is idle.
        let snap = pb.snapshot().await;
        assert_eq!(snap.state, "idle");
        assert_eq!(snap.revision, 0);
        assert_eq!(snap.position_ms, 0);

        // Load track.
        let load_snap = pb
            .load(LoadRequest {
                context_uri: None,
                track_uri: Some("spotify:track:test12345"),
                name: None,
                artists: None,
                album: None,
                duration_ms: None,
                genre: None,
            })
            .await
            .expect("load should succeed");
        assert_eq!(load_snap.state, "loading");
        assert_eq!(load_snap.revision, 1);
        assert_eq!(
            load_snap.track.as_ref().map(|t| t.name.as_str()),
            Some("Track test12345")
        );

        // Event should be emitted.
        let event = rx.recv().await.expect("playback.changed event");
        assert!(event.contains("playback.changed"));
        assert!(event.contains("loading"));

        // Play.
        let play_snap = pb.play().await.expect("play should succeed");
        assert_eq!(play_snap.state, "playing");
        assert_eq!(play_snap.revision, 2);

        let event = rx.recv().await.expect("playback.changed event");
        assert!(event.contains("playing"));

        // Pause.
        let pause_snap = pb.pause().await.expect("pause should succeed");
        assert_eq!(pause_snap.state, "paused");
        assert_eq!(pause_snap.revision, 3);

        // Toggle back to playing.
        let toggle_snap = pb.toggle().await.expect("toggle should succeed");
        assert_eq!(toggle_snap.state, "playing");
        assert_eq!(toggle_snap.revision, 4);

        // Seek.
        let seek_snap = pb.seek(15_000).await.expect("seek should succeed");
        assert_eq!(seek_snap.position_ms, 15_000);

        // Volume clamping.
        let vol_snap = pb.set_volume(0.5).await.expect("valid volume");
        assert!((vol_snap.volume - 0.5).abs() < 0.001);
        assert!(vol_snap.revision == 6, "set_volume should bump revision");
        let _ = rx.recv().await.expect("set_volume changed event");
        assert!(pb.set_volume(1.2).await.is_err());
        assert!(pb.set_volume(-0.1).await.is_err());

        // Repeat mode validation.
        let rep_snap = pb.set_repeat("context").await.expect("valid repeat");
        assert_eq!(rep_snap.repeat, "context");
        assert!(rep_snap.revision == 7, "set_repeat should bump revision");
        let _ = rx.recv().await.expect("set_repeat changed event");
        assert!(pb.set_repeat("invalid_mode").await.is_err());
    }
}
