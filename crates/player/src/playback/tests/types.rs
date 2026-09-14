use super::super::*;
use tokio::sync::mpsc;

#[test]
fn test_device_mode_and_audio_backend_types() {
    assert_eq!(DeviceMode::Integrated.as_str(), "integrated");
    assert_eq!(DeviceMode::ConnectOnly.as_str(), "connect_only");
    assert_eq!(
        "integrated".parse::<DeviceMode>().unwrap(),
        DeviceMode::Integrated
    );
    assert_eq!(
        "connect_only".parse::<DeviceMode>().unwrap(),
        DeviceMode::ConnectOnly
    );
    assert_eq!(
        "connect".parse::<DeviceMode>().unwrap(),
        DeviceMode::ConnectOnly
    );

    assert_eq!(AudioBackend::Rodio.as_str(), "rodio");
    assert_eq!(AudioBackend::Alsa.as_str(), "alsa");
    assert_eq!(AudioBackend::Pulseaudio.as_str(), "pulseaudio");
    assert_eq!(AudioBackend::Dummy.as_str(), "dummy");

    assert_eq!(
        "rodio".parse::<AudioBackend>().unwrap(),
        AudioBackend::Rodio
    );
    assert_eq!("alsa".parse::<AudioBackend>().unwrap(), AudioBackend::Alsa);
    assert_eq!(
        "pulseaudio".parse::<AudioBackend>().unwrap(),
        AudioBackend::Pulseaudio
    );
    assert_eq!(
        "pulse".parse::<AudioBackend>().unwrap(),
        AudioBackend::Pulseaudio
    );
    assert_eq!(
        "dummy".parse::<AudioBackend>().unwrap(),
        AudioBackend::Dummy
    );

    // JSON serialization
    let serialized = serde_json::to_string(&DeviceMode::ConnectOnly).unwrap();
    assert_eq!(serialized, "\"connect_only\"");
    let de: DeviceMode = serde_json::from_str("\"integrated\"").unwrap();
    assert_eq!(de, DeviceMode::Integrated);
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
async fn test_playback_snapshot_observed_at_monotonic_ms_is_unix_timestamp() {
    let (tx, _rx) = mpsc::channel::<String>(16);
    let pb = Playback::new(FakeEngine, tx);
    let snap = pb.snapshot().await;
    // Must be a valid unix epoch millisecond timestamp (> 1_700_000_000_000, roughly late 2023 onwards)
    assert!(
        snap.observed_at_monotonic_ms > 1_700_000_000_000,
        "expected unix ms timestamp, got {}",
        snap.observed_at_monotonic_ms
    );
}
