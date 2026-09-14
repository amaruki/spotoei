use super::super::*;
use tokio::sync::mpsc;

#[tokio::test]
async fn test_load_with_autoplay_starts_in_loading_until_player_event() {
    use ::librespot::core::spotify_uri::SpotifyUri;
    use ::librespot::playback::player::PlayerEvent;

    let (tx, mut rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    let snap = pb
        .load_opts(
            LoadRequest {
                context_uri: None,
                track_uri: Some("spotify:track:autoplay1"),
                queue_uris: None,
                name: Some("Autoplay Track"),
                artists: Some(vec!["Artist".to_string()]),
                album: None,
                duration_ms: Some(100_000),
                genre: None,
            },
            true,
        )
        .await
        .expect("load should succeed");
    assert_eq!(snap.state, "loading");
    assert_eq!(snap.position_ms, 0);
    let event = rx.recv().await.expect("playback.changed event");
    assert!(event.contains("loading"));

    // FakeEngine never emits events; simulate librespot starting the
    // stream, which is the only transition to Playing.
    pb.handle_player_event(PlayerEvent::Playing {
        play_request_id: 1,
        track_id: SpotifyUri::from_uri("spotify:track:6rqhFgbbKwnb9MLmUQDhG6").unwrap(),
        position_ms: 0,
    })
    .await;
    assert_eq!(pb.snapshot().await.state, "playing");
    let _ = rx.recv().await.expect("playing event");
}

#[tokio::test]
async fn test_context_only_load_uses_placeholder_track() {
    let (tx, mut rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    let snap = pb
        .load_opts(
            LoadRequest {
                context_uri: Some("spotify:album:ctx1"),
                track_uri: None,
                queue_uris: None,
                name: Some("My Album"),
                artists: None,
                album: None,
                duration_ms: None,
                genre: None,
            },
            true,
        )
        .await
        .expect("context load should succeed");
    assert_eq!(snap.state, "loading");
    assert_eq!(
        snap.track.as_ref().map(|t| t.name.as_str()),
        Some("My Album")
    );
    let event = rx.recv().await.expect("context load event");
    assert!(event.contains("loading"));
}

#[tokio::test]
async fn test_loading_watchdog_returns_to_idle_after_timeout() {
    let (tx, mut rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    pb.load(LoadRequest {
        context_uri: None,
        track_uri: Some("spotify:track:stuck"),
        queue_uris: None,
        name: None,
        artists: None,
        album: None,
        duration_ms: None,
        genre: None,
    })
    .await
    .expect("load should succeed");
    let _ = rx.recv().await.expect("load event");
    assert_eq!(pb.snapshot().await.state, "loading");

    {
        let mut inner = pb.inner.lock().await;
        inner.last_change_at = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(21))
            .expect("instant within range");
    }
    pb.tick().await;

    assert_eq!(pb.snapshot().await.state, "idle");
    let event = rx.recv().await.expect("idle event");
    assert!(event.contains("idle"));
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
