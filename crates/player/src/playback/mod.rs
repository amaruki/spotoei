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
                queue_uris: None,
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

    #[tokio::test]
    async fn test_set_autoplay_unchanged_emits_nothing() {
        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        // Default is already `true`: no bump, no event.
        let snap = pb.set_autoplay(true).await.expect("set_autoplay");
        assert!(snap.autoplay);
        assert_eq!(snap.revision, 0);
        assert!(rx.try_recv().is_err(), "unchanged autoplay must not emit");

        // An actual change bumps revision and emits exactly one event.
        let snap = pb.set_autoplay(false).await.expect("set_autoplay");
        assert!(!snap.autoplay);
        assert_eq!(snap.revision, 1);
        let event = rx.recv().await.expect("changed event");
        assert!(event.contains("playback.changed"));
        assert!(rx.try_recv().is_err(), "exactly one event expected");
    }

    #[tokio::test]
    async fn test_tick_detects_end_from_clamped_position() {
        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        pb.load(LoadRequest {
            context_uri: None,
            track_uri: Some("spotify:track:shorty"),
            queue_uris: None,
            name: None,
            artists: None,
            album: None,
            duration_ms: Some(300),
            genre: None,
        })
        .await
        .expect("load should succeed");
        pb.play().await.expect("play should succeed");
        // Drain load/play events.
        let _ = rx.recv().await;
        let _ = rx.recv().await;

        // Simulate the position clock saturating at the duration (the tick
        // clamps `position_ms`, so the raw accumulator stops growing).
        {
            let mut inner = pb.inner.lock().await;
            inner.position_ms = 300;
        }
        pb.tick().await;

        assert_eq!(pb.snapshot().await.state, "idle");
        let event = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .expect("idle event must arrive")
            .expect("channel open");
        assert!(event.contains("idle"));
    }

    #[tokio::test]
    async fn test_seek_relative_and_toggle_mute() {
        let (tx, _rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        pb.load(LoadRequest {
            context_uri: None,
            track_uri: Some("spotify:track:test_rel"),
            queue_uris: None,
            name: None,
            artists: None,
            album: None,
            duration_ms: Some(60_000),
            genre: None,
        })
        .await
        .expect("load should succeed");

        // Seek to 10s
        let snap = pb.seek(10_000).await.expect("seek");
        assert_eq!(snap.position_ms, 10_000);

        // Relative seek +5s -> 15s
        let snap = pb.seek_relative(5_000).await.expect("seek relative forward");
        assert_eq!(snap.position_ms, 15_000);

        // Relative seek -20s -> clamps to 0s
        let snap = pb.seek_relative(-20_000).await.expect("seek relative backward clamped");
        assert_eq!(snap.position_ms, 0);

        // Toggle mute: initial volume is > 0, so muting drops volume to 0.0
        let snap = pb.toggle_mute().await.expect("mute toggle");
        assert_eq!(snap.volume, 0.0);

        // Toggle unmute restores non-zero volume
        let snap = pb.toggle_mute().await.expect("unmute toggle");
        assert!(snap.volume > 0.0);
    }

    #[test]
    fn test_device_mode_and_audio_backend_types() {
        assert_eq!(DeviceMode::Integrated.as_str(), "integrated");
        assert_eq!(DeviceMode::ConnectOnly.as_str(), "connect_only");
        assert_eq!("integrated".parse::<DeviceMode>().unwrap(), DeviceMode::Integrated);
        assert_eq!("connect_only".parse::<DeviceMode>().unwrap(), DeviceMode::ConnectOnly);
        assert_eq!("connect".parse::<DeviceMode>().unwrap(), DeviceMode::ConnectOnly);

        assert_eq!(AudioBackend::Rodio.as_str(), "rodio");
        assert_eq!(AudioBackend::Alsa.as_str(), "alsa");
        assert_eq!(AudioBackend::Pulseaudio.as_str(), "pulseaudio");
        assert_eq!(AudioBackend::Dummy.as_str(), "dummy");

        assert_eq!("rodio".parse::<AudioBackend>().unwrap(), AudioBackend::Rodio);
        assert_eq!("alsa".parse::<AudioBackend>().unwrap(), AudioBackend::Alsa);
        assert_eq!("pulseaudio".parse::<AudioBackend>().unwrap(), AudioBackend::Pulseaudio);
        assert_eq!("pulse".parse::<AudioBackend>().unwrap(), AudioBackend::Pulseaudio);
        assert_eq!("dummy".parse::<AudioBackend>().unwrap(), AudioBackend::Dummy);

        // JSON serialization
        let serialized = serde_json::to_string(&DeviceMode::ConnectOnly).unwrap();
        assert_eq!(serialized, "\"connect_only\"");
        let de: DeviceMode = serde_json::from_str("\"integrated\"").unwrap();
        assert_eq!(de, DeviceMode::Integrated);
    }

    #[tokio::test]
    async fn test_playback_device_mode_and_backend_controls() {
        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        assert_eq!(pb.device_mode().await, DeviceMode::Integrated);
        assert_eq!(pb.audio_backend().await, AudioBackend::Rodio);

        let snap = pb.set_device_mode(DeviceMode::ConnectOnly).await;
        assert_eq!(snap.device_mode, Some("connect_only".to_string()));
        assert_eq!(pb.device_mode().await, DeviceMode::ConnectOnly);

        let event = rx.recv().await.expect("playback.changed event");
        assert!(event.contains("connect_only"));

        let backend = pb.set_audio_backend(AudioBackend::Dummy).await;
        assert_eq!(backend, AudioBackend::Dummy);
        assert_eq!(pb.audio_backend().await, AudioBackend::Dummy);
    }

    #[test]
    fn test_dummy_sink_lifecycle() {
        use ::librespot::playback::audio_backend::Sink;
        let mut dummy = DummySink::new();
        assert!(dummy.start().is_ok());
        assert!(dummy.stop().is_ok());
    }

    #[test]
    fn test_librespot_config_resolution() {
        let cfg = LibrespotConfig::default();
        assert_eq!(cfg.device_mode, DeviceMode::Integrated);
        assert_eq!(cfg.audio_backend, AudioBackend::Rodio);
        assert_eq!(cfg.device_name, "Spotoei");
        assert!(cfg.gapless);
        assert!(cfg.normalisation);
        assert_eq!(cfg.bitrate, Bitrate::Bitrate320);
        assert_eq!(cfg.crossfade_duration_ms, 0);
        assert_eq!(cfg.normalisation_type, "album");
        assert_eq!(cfg.pregain, 0.0);
    }

    #[tokio::test]
    async fn test_playback_reconciles_player_events() {
        use ::librespot::core::spotify_uri::SpotifyUri;
        use ::librespot::playback::player::PlayerEvent;

        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        let track_uri = SpotifyUri::from_uri("spotify:track:6rqhFgbbKwnb9MLmUQDhG6").unwrap();

        // 1. Playing event
        pb.handle_player_event(PlayerEvent::Playing {
            play_request_id: 1,
            track_id: track_uri.clone(),
            position_ms: 5000,
        })
        .await;

        let snap = pb.snapshot().await;
        assert_eq!(snap.state, "playing");
        assert_eq!(snap.position_ms, 5000);
        let event = rx.recv().await.expect("playback.changed for playing");
        assert!(event.contains("playback.changed"));
        assert!(event.contains("playing"));

        // 2. PositionCorrection event
        pb.handle_player_event(PlayerEvent::PositionCorrection {
            play_request_id: 1,
            track_id: track_uri.clone(),
            position_ms: 12000,
        })
        .await;

        let pos_event = rx.recv().await.expect("playback.position event");
        assert!(pos_event.contains("playback.position"));
        assert!(pos_event.contains("12000"));

        // 3. VolumeChanged event
        pb.handle_player_event(PlayerEvent::VolumeChanged { volume: 32768 })
            .await;
        let snap = pb.snapshot().await;
        assert!((snap.volume - 0.5).abs() < 0.01);
        let vol_event = rx.recv().await.expect("playback.changed for volume");
        assert!(vol_event.contains("playback.changed"));

        // 4. Paused event
        pb.handle_player_event(PlayerEvent::Paused {
            play_request_id: 1,
            track_id: track_uri.clone(),
            position_ms: 12000,
        })
        .await;
        let snap = pb.snapshot().await;
        assert_eq!(snap.state, "paused");
        let pause_event = rx.recv().await.expect("playback.changed for pause");
        assert!(pause_event.contains("paused"));

        // 5. Stopped event
        pb.handle_player_event(PlayerEvent::Stopped {
            play_request_id: 1,
            track_id: track_uri,
        })
        .await;
        let snap = pb.snapshot().await;
        assert_eq!(snap.state, "idle");
        let stop_event = rx.recv().await.expect("playback.changed for stop");
        assert!(stop_event.contains("idle"));
    }

    #[tokio::test]
    async fn test_playback_audio_settings_clamping_and_validation() {
        let (tx, _rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        // Crossfade duration: clamp 0..=15_000
        assert_eq!(pb.set_crossfade_duration_ms(5000).await, 5000);
        assert_eq!(pb.crossfade_duration_ms().await, 5000);
        assert_eq!(pb.set_crossfade_duration_ms(20_000).await, 15_000);
        assert_eq!(pb.crossfade_duration_ms().await, 15_000);
        assert_eq!(pb.set_crossfade_duration_ms(0).await, 0);
        assert_eq!(pb.crossfade_duration_ms().await, 0);

        // Pregain: clamp -20.0..=20.0
        assert_eq!(pb.set_pregain(5.5).await, 5.5);
        assert_eq!(pb.pregain().await, 5.5);
        assert_eq!(pb.set_pregain(-30.0).await, -20.0);
        assert_eq!(pb.pregain().await, -20.0);
        assert_eq!(pb.set_pregain(25.0).await, 20.0);
        assert_eq!(pb.pregain().await, 20.0);
        assert_eq!(pb.set_pregain(f32::NAN).await, 0.0);
        assert_eq!(pb.pregain().await, 0.0);

        // Normalisation type: "album" or "track" (default "album")
        assert_eq!(pb.set_normalisation_type("track").await, "track");
        assert_eq!(pb.normalisation_type().await, "track");
        assert_eq!(pb.set_normalisation_type("TRACK").await, "track");
        assert_eq!(pb.normalisation_type().await, "track");
        assert_eq!(pb.set_normalisation_type("album").await, "album");
        assert_eq!(pb.normalisation_type().await, "album");
        assert_eq!(pb.set_normalisation_type("invalid_type").await, "album");
        assert_eq!(pb.normalisation_type().await, "album");
    }
}
