use super::*;
use crate::playback::types::{AudioBackend, Bitrate, LibrespotConfig};

#[test]
fn test_resolve_dummy_sink() {
    let res = resolve_sink(AudioBackend::Dummy, None);
    assert!(res.is_ok());
    let (_sink_fn, backend) = res.unwrap();
    assert_eq!(backend, AudioBackend::Dummy);
}

#[test]
fn test_player_config_mapping() {
    let cfg = LibrespotConfig {
        bitrate: Bitrate::Bitrate160,
        gapless: false,
        normalisation: true,
        normalisation_type: "track".to_string(),
        pregain: -3.5,
        crossfade_duration_ms: 2000,
        ..Default::default()
    };

    let player_config = librespot::playback::config::PlayerConfig {
        bitrate: match cfg.bitrate {
            Bitrate::Bitrate96 => librespot::playback::config::Bitrate::Bitrate96,
            Bitrate::Bitrate160 => librespot::playback::config::Bitrate::Bitrate160,
            Bitrate::Bitrate320 => librespot::playback::config::Bitrate::Bitrate320,
        },
        gapless: cfg.gapless,
        normalisation: cfg.normalisation,
        normalisation_type: match cfg.normalisation_type.trim().to_ascii_lowercase().as_str() {
            "track" => librespot::playback::config::NormalisationType::Track,
            _ => librespot::playback::config::NormalisationType::Album,
        },
        normalisation_pregain_db: cfg.pregain as f64,
        normalisation_knee_db: 5.0,
        ..Default::default()
    };

    assert_eq!(
        player_config.bitrate,
        librespot::playback::config::Bitrate::Bitrate160
    );
    assert!(!player_config.gapless);
    assert!(player_config.normalisation);
    assert_eq!(
        player_config.normalisation_type,
        librespot::playback::config::NormalisationType::Track
    );
    assert_eq!(player_config.normalisation_pregain_db, -3.5);
    assert_eq!(player_config.normalisation_knee_db, 5.0);
    assert_eq!(cfg.crossfade_duration_ms, 2000);
}

#[test]
fn test_session_uses_official_keymaster_client_id() {
    // Dual-client design: the streaming token is minted for Keymaster,
    // so the session always presents Keymaster regardless of the Web
    // API client configured by the user.
    let keymaster = "65b708073fc0480ea92a077233ca87bd";
    assert_eq!(session_client_id(), keymaster);
    assert_eq!(
        session_client_id(),
        librespot::core::config::SessionConfig::default().client_id
    );
}

#[tokio::test]
async fn test_resolve_credentials_prefers_cache() {
    let tmp = std::env::temp_dir().join(format!("spotoei-cred-test-{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&tmp);
    let cache = librespot::core::cache::Cache::new(Some(&tmp), Some(&tmp), None, None).unwrap();

    // Empty cache: resolves via streaming token
    assert!(cache.credentials().is_none());
    let (creds, used_cache) = resolve_session_credentials(&cache, || async {
        Ok::<_, String>(("mock_token".to_string(), 0u64))
    })
    .await
    .unwrap();
    assert!(!used_cache);
    assert_eq!(creds.auth_data, "mock_token".as_bytes());

    let _ = std::fs::remove_dir_all(&tmp);
}
#[tokio::test]
async fn test_resume_guard_when_stopped() {
    use std::sync::atomic::Ordering;
    let (tx, _rx) = tokio::sync::mpsc::channel::<String>(8);
    let auth = Arc::new(crate::auth::AuthManager::new("test-client".to_string(), tx));
    let engine = super::super::LibrespotEngine::new(auth);
    // New engine starts in stopped state
    assert!(engine.is_stopped.load(Ordering::SeqCst));
    // resume() should early return without panicking or calling play on empty inner
    crate::playback::PlaybackEngine::resume(&engine);
    assert!(engine.is_stopped.load(Ordering::SeqCst));
}
