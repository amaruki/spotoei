use super::*;
use crate::playback::{FakeEngine, Playback};
use tokio::sync::mpsc;

#[tokio::test]
async fn test_dispatch_seek_relative_and_toggle_mute() {
    let (tx, _rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    pb.load(crate::playback::LoadRequest {
        context_uri: None,
        track_uri: Some("spotify:track:test_cmd"),
        queue_uris: None,
        name: None,
        artists: None,
        album: None,
        duration_ms: Some(50_000),
        genre: None,
    })
    .await
    .unwrap();

    let cmd_seek_rel = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-1".to_string(),
        command: "playback.seek_relative".to_string(),
        data: serde_json::json!({ "offsetMs": 10000 }),
    };
    let res = dispatch("playback.seek_relative", &cmd_seek_rel, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"positionMs\":10000"));

    let cmd_toggle = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-2".to_string(),
        command: "playback.toggle_mute".to_string(),
        data: serde_json::json!({}),
    };
    let res = dispatch("playback.toggle_mute", &cmd_toggle, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"volume\":0.0"));
}

#[tokio::test]
async fn test_dispatch_device_mode_and_audio_backend() {
    let (tx, _rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    let cmd_get_mode = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-mode-1".to_string(),
        command: "playback.get_device_mode".to_string(),
        data: serde_json::json!({}),
    };
    let res = dispatch("playback.get_device_mode", &cmd_get_mode, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"deviceMode\":\"integrated\""));

    let cmd_set_mode = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-mode-2".to_string(),
        command: "playback.set_device_mode".to_string(),
        data: serde_json::json!({ "deviceMode": "connect_only" }),
    };
    let res = dispatch("playback.set_device_mode", &cmd_set_mode, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"deviceMode\":\"connect_only\""));

    let cmd_set_backend = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-backend-1".to_string(),
        command: "playback.set_audio_backend".to_string(),
        data: serde_json::json!({ "audioBackend": "dummy" }),
    };
    let res = dispatch("playback.set_audio_backend", &cmd_set_backend, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"audioBackend\":\"dummy\""));

    let cmd_get_backend = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-backend-2".to_string(),
        command: "playback.get_audio_backend".to_string(),
        data: serde_json::json!({}),
    };
    let res = dispatch("playback.get_audio_backend", &cmd_get_backend, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"audioBackend\":\"dummy\""));
}

#[tokio::test]
async fn test_dispatch_bitrate_crossfade_normalisation() {
    let (tx, _rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);

    let cmd_get_b = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-b-1".to_string(),
        command: "playback.get_bitrate".to_string(),
        data: serde_json::json!({}),
    };
    let res = dispatch("playback.get_bitrate", &cmd_get_b, &pb).await;
    assert!(res.contains("\"bitrate\":\"320\""));

    let cmd_set_b = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-b-2".to_string(),
        command: "playback.set_bitrate".to_string(),
        data: serde_json::json!({ "bitrate": "160" }),
    };
    let res = dispatch("playback.set_bitrate", &cmd_set_b, &pb).await;
    assert!(res.contains("\"bitrate\":\"160\""));

    let cmd_set_cf = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-cf-1".to_string(),
        command: "playback.set_crossfade".to_string(),
        data: serde_json::json!({ "crossfadeDurationMs": 3000 }),
    };
    let res = dispatch("playback.set_crossfade", &cmd_set_cf, &pb).await;
    assert!(res.contains("\"crossfadeDurationMs\":3000"));

    let cmd_set_norm = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-n-1".to_string(),
        command: "playback.set_normalisation".to_string(),
        data: serde_json::json!({ "normalisation": false }),
    };
    let res = dispatch("playback.set_normalisation", &cmd_set_norm, &pb).await;
    assert!(res.contains("\"normalisation\":false"));

    let cmd_set_nt = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-nt-1".to_string(),
        command: "playback.set_normalisation_type".to_string(),
        data: serde_json::json!({ "normalisationType": "track" }),
    };
    let res = dispatch("playback.set_normalisation_type", &cmd_set_nt, &pb).await;
    assert!(res.contains("\"normalisationType\":\"track\""));

    let cmd_set_pg = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-pg-1".to_string(),
        command: "playback.set_pregain".to_string(),
        data: serde_json::json!({ "pregain": 2.5 }),
    };
    let res = dispatch("playback.set_pregain", &cmd_set_pg, &pb).await;
    assert!(res.contains("\"pregain\":2.5"));

    let cmd_get_cfg = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-cfg-1".to_string(),
        command: "playback.get_audio_config".to_string(),
        data: serde_json::json!({}),
    };
    let res = dispatch("playback.get_audio_config", &cmd_get_cfg, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"bitrate\":"));
    assert!(res.contains("\"audioBackend\":"));
    assert!(res.contains("\"crossfadeDurationMs\":"));
    assert!(res.contains("\"deviceMode\":"));
    assert!(res.contains("\"normalisation\":"));
    assert!(res.contains("\"pregain\":"));

    let cmd_set_cfg = Command {
        version: crate::protocol::PROTOCOL_VERSION,
        kind: "command".to_string(),
        id: "cmd-cfg-2".to_string(),
        command: "playback.set_audio_config".to_string(),
        data: serde_json::json!({
            "bitrate": "96",
            "crossfadeDurationMs": 5000,
            "normalisation": false,
            "pregain": -1.5,
        }),
    };
    let res = dispatch("playback.set_audio_config", &cmd_set_cfg, &pb).await;
    assert!(res.contains("\"ok\":true"));
    assert!(res.contains("\"bitrate\":\"96\""));
    assert!(res.contains("\"crossfadeDurationMs\":5000"));
    assert!(res.contains("\"normalisation\":false"));
    assert!(res.contains("\"pregain\":-1.5"));
}
