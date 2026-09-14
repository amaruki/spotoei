use super::super::*;
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
    let snap = pb
        .seek_relative(5_000)
        .await
        .expect("seek relative forward");
    assert_eq!(snap.position_ms, 15_000);

    // Relative seek -20s -> clamps to 0s
    let snap = pb
        .seek_relative(-20_000)
        .await
        .expect("seek relative backward clamped");
    assert_eq!(snap.position_ms, 0);

    // Toggle mute: initial volume is > 0, so muting drops volume to 0.0
    let snap = pb.toggle_mute().await.expect("mute toggle");
    assert_eq!(snap.volume, 0.0);

    // Toggle unmute restores non-zero volume
    let snap = pb.toggle_mute().await.expect("unmute toggle");
    assert!(snap.volume > 0.0);
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

#[tokio::test]
async fn test_playback_settings_advance_and_preserve_position_when_playing() {
    use ::librespot::core::spotify_uri::SpotifyUri;
    use ::librespot::playback::player::PlayerEvent;

    let (tx, _rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);
    let track_uri = SpotifyUri::from_uri("spotify:track:6rqhFgbbKwnb9MLmUQDhG6").unwrap();

    pb.handle_player_event(PlayerEvent::Playing {
        play_request_id: 1,
        track_id: track_uri,
        position_ms: 10_000,
    })
    .await;

    // Wait 15ms so elapsed time accumulates
    tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;

    // Toggling shuffle while playing must advance position and not reset to 0 or jump to max
    let snap_shuffle = pb.set_shuffle(true).await.expect("set_shuffle");
    assert!(snap_shuffle.position_ms >= 10_015);
    assert!(snap_shuffle.shuffle);
    assert!(snap_shuffle.observed_at_monotonic_ms > 1_700_000_000_000);

    // Toggling repeat while playing must also preserve/advance position
    tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
    let snap_repeat = pb.set_repeat("context").await.expect("set_repeat");
    assert!(snap_repeat.position_ms >= snap_shuffle.position_ms + 15);
    assert_eq!(snap_repeat.repeat, "context");

    // Changing volume while playing must also preserve/advance position
    tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
    let snap_vol = pb.set_volume(0.9).await.expect("set_volume");
    assert!(snap_vol.position_ms >= snap_repeat.position_ms + 15);
}
