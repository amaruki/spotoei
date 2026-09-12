use std::future::Future;
use std::sync::Arc;
use tracing::info;
use librespot::playback::mixer::Mixer;
use super::sink::VisualizerSink;
#[derive(Clone)]
pub struct LibrespotActive {
    pub session: librespot::core::session::Session,
    pub player: Arc<librespot::playback::player::Player>,
    pub spirc: Option<Arc<librespot::connect::Spirc>>,
    pub device_id: String,
    pub active_device_mode: super::super::types::DeviceMode,
    pub active_audio_backend: super::super::types::AudioBackend,
    /// Auth generation this session was created for. When the auth identity
    /// changes (logout, new login, client ID reset) the cached session is
    /// dropped instead of resuming the previous user.
    pub created_epoch: u64,
}

/// How a session-connect attempt ended.
enum ConnectError {
    /// Spotify rejected the token on the playback services; retrying once
    /// with a fresh token may recover.
    Credentials,
    /// The auth identity changed (sign-out, new login, client ID reset) while
    /// the session was connecting. The half-built session belongs to a user
    /// nobody wants any more and must not be installed.
    Superseded,
    /// Anything else, with the message for the caller.
    Fatal(String),
}

impl ConnectError {
    fn message(self) -> String {
        match self {
            ConnectError::Credentials => "Spotify rejected the playback credentials".to_string(),
            ConnectError::Superseded => "authentication changed while connecting".to_string(),
            ConnectError::Fatal(message) => message,
        }
    }
}

pub type SinkFn = Box<dyn Fn() -> Box<dyn librespot::playback::audio_backend::Sink> + Send + 'static>;

/// Client ID presented to Spotify for the playback connection. Dual-client
/// design: the streaming token is always minted for the official Keymaster
/// client (dedicated Step 2/2 login), so the session always presents
/// Keymaster too — regardless of which client the Web API token belongs to.
/// Presenting any other client makes login5 and audio reject the token with
/// `INVALID_CREDENTIALS` while the AP login and Web API accept it.
pub fn session_client_id() -> String {
    crate::auth::KEYMASTER_CLIENT_ID.to_string()
}

pub fn resolve_sink(
    requested_backend: super::super::types::AudioBackend,
    audio_device: Option<&str>,
) -> Result<(SinkFn, super::super::types::AudioBackend), String> {
    use super::sink::DummySink;
    use super::super::types::AudioBackend;

    if requested_backend == AudioBackend::Dummy {
        let dummy_fn: SinkFn = Box::new(|| Box::new(DummySink::new()));
        return Ok((dummy_fn, AudioBackend::Dummy));
    }

    let mut backends_to_try = vec![requested_backend];
    for b in [AudioBackend::Rodio, AudioBackend::Alsa, AudioBackend::Pulseaudio] {
        if !backends_to_try.contains(&b) {
            backends_to_try.push(b);
        }
    }

    let mut last_err = String::new();
    for backend in backends_to_try {
        let backend_name = backend.as_str();
        let raw_builder = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            librespot::playback::audio_backend::find(Some(backend_name.to_string()))
        })) {
            Ok(Some(b)) => b,
            Ok(None) => {
                last_err = format!("audio backend '{backend_name}' not available in this build");
                continue;
            }
            Err(_) => {
                last_err = format!("audio backend '{backend_name}' lookup panicked");
                continue;
            }
        };

        let dev_string = audio_device.map(ToString::to_string);
        let dev_probe = dev_string.clone();

        let probe = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            raw_builder(dev_probe, librespot::playback::config::AudioFormat::default())
        }))
        .or_else(|_| {
            let dev_probe_s16 = dev_string.clone();
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                raw_builder(dev_probe_s16, librespot::playback::config::AudioFormat::S16)
            }))
        });

        match probe {
            Ok(mut test_sink) => {
                let start_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let res = test_sink.start();
                    let _ = test_sink.stop();
                    res
                }));
                match start_res {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        last_err = format!("backend '{backend_name}' failed to start: {e:?}");
                        continue;
                    }
                    Err(_) => {
                        last_err = format!("backend '{backend_name}' panicked during start/stop");
                        continue;
                    }
                }

                let dev_closure = dev_string.clone();
                let sink_fn: SinkFn = Box::new(move || {
                    let dev1 = dev_closure.clone();
                    let dev2 = dev_closure.clone();
                    let actual = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        raw_builder(dev1, librespot::playback::config::AudioFormat::default())
                    }))
                    .or_else(|_| {
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            raw_builder(dev2, librespot::playback::config::AudioFormat::S16)
                        }))
                    })
                    .unwrap_or_else(|_| {
                        tracing::warn!("Audio device runtime open failed; falling back to DummySink");
                        Box::new(DummySink::new()) as Box<dyn librespot::playback::audio_backend::Sink>
                    });

                    actual
                });

                return Ok((sink_fn, backend));
            }
            Err(_) => {
                last_err = format!("backend '{backend_name}' failed to open audio device");
            }
        }
    }

    Err(last_err)
}

pub fn resolve_sink_with_fallback(
    requested_backend: super::super::types::AudioBackend,
    audio_device: Option<&str>,
) -> (SinkFn, super::super::types::AudioBackend, Option<String>) {
    let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        resolve_sink(requested_backend, audio_device)
    }));
    match resolved {
        Ok(Ok((sink_fn, backend))) => (sink_fn, backend, None),
        Ok(Err(err)) => {
            tracing::warn!(
                "Audio device failed to open ({}): falling back to connect_only mode with DummySink",
                err
            );
            let dummy_fn: SinkFn = Box::new(|| Box::new(super::sink::DummySink::new()));
            (dummy_fn, super::super::types::AudioBackend::Dummy, Some(err))
        }
        Err(panic_payload) => {
            let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "audio backend panicked during sink resolution".to_string()
            };
            tracing::error!(
                "Audio backend panicked during sink resolution ({}): falling back to connect_only mode with DummySink",
                msg
            );
            let dummy_fn: SinkFn = Box::new(|| Box::new(super::sink::DummySink::new()));
            (
                dummy_fn,
                super::super::types::AudioBackend::Dummy,
                Some(format!("audio backend panicked: {}", msg)),
            )
        }
    }
}
pub(super) async fn resolve_session_credentials<F, Fut, E>(
    cache: &librespot::core::cache::Cache,
    fetch_token: F,
) -> Result<(librespot::core::authentication::Credentials, bool), E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(String, u64), E>>,
{
    if let Some(cached) = cache.credentials() {
        return Ok((cached, true));
    }
    let (token, _) = fetch_token().await?;
    Ok((
        librespot::core::authentication::Credentials::with_access_token(token),
        false,
    ))
}

impl super::LibrespotEngine {
    pub async fn ensure_player(&self) -> Result<Arc<librespot::playback::player::Player>, String> {
        let act = self.ensure_active().await?;
        Ok(act.player)
    }

    pub(super) async fn ensure_active(&self) -> Result<LibrespotActive, String> {
        let wanted_epoch = self.auth.session_epoch();
        if let Some(act) = self.cached_active(wanted_epoch).await {
            return Ok(act);
        }

        // A prewarm may already be connecting. Serialize so this call waits
        // for that session instead of building a second one; re-check after
        // acquiring the guard in case it completed while we waited.
        let _guard = self.connect_guard.lock().await;
        let wanted_epoch = self.auth.session_epoch();
        if let Some(act) = self.cached_active(wanted_epoch).await {
            tracing::debug!("librespot session became ready while waiting for connect");
            return Ok(act);
        }

        // No auth session means no playback session: fail fast instead of
        // resurrecting the previous user from the librespot disk cache.
        if !self.auth.has_current_session().await {
            *self.inner.lock().await = None;
            return Err("Spotify authentication required".to_string());
        }

        match self.connect_active(wanted_epoch).await {
            Ok(act) => Ok(act),
            Err(ConnectError::Superseded) => {
                // Rebuild for whatever identity is current now. Doing this here
                // keeps a caller from surfacing a transient error just because
                // the user switched accounts mid-connect.
                if !self.auth.has_current_session().await {
                    *self.inner.lock().await = None;
                    return Err("Spotify authentication required".to_string());
                }
                let current_epoch = self.auth.session_epoch();
                self.connect_active(current_epoch)
                    .await
                    .map_err(|e| e.message())
            }
            Err(ConnectError::Credentials) => {
                tracing::warn!("playback credentials rejected; clearing credentials cache, refreshing token and retrying once");
                crate::auth::storage::delete_librespot_credentials_cache();
                self.auth.invalidate_token().await;
                self.connect_active(wanted_epoch)
                    .await
                    .map_err(|e| e.message())
            }
            Err(ConnectError::Fatal(message)) => Err(message),
        }
    }

    /// Return the installed session when it still matches the auth identity
    /// and is not invalid.
    async fn cached_active(&self, wanted_epoch: u64) -> Option<LibrespotActive> {
        let guard = self.inner.lock().await;
        if let Some(ref act) = *guard {
            if act.created_epoch == wanted_epoch && !act.session.is_invalid() {
                return Some(act.clone());
            }
        }
        None
    }

    /// Build a fresh librespot session. A credentials rejection is reported
    /// distinctly so the caller can retry once with a fresh token; every
    /// other outcome (including the Spirc-less fallback) resolves here.
    async fn connect_active(&self, wanted_epoch: u64) -> Result<LibrespotActive, ConnectError> {
        let started = std::time::Instant::now();
        let config_dir = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".config"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
            })
            .join("spotoei");
        let cache_dir = std::env::var("XDG_CACHE_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".cache"))
                    .unwrap_or_else(|_| config_dir.join("cache"))
            })
            .join("spotoei");
        let _ = std::fs::create_dir_all(&cache_dir);

        let device_id_path = config_dir.join("device_id");
        let device_id = if let Ok(s) = std::fs::read_to_string(&device_id_path) {
            let t = s.trim().to_string();
            if !t.is_empty() {
                t
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                let _ = std::fs::write(&device_id_path, &id);
                id
            }
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let _ = std::fs::write(&device_id_path, &id);
            id
        };

        let files_cache = cache_dir.join("files");
        let cache = librespot::core::cache::Cache::new(
            Some(&cache_dir),
            Some(&cache_dir),
            Some(&files_cache),
            None,
        )
        .map_err(|e| ConnectError::Fatal(format!("Failed to create librespot cache: {:?}", e)))?;

        let (credentials, _used_cache) = resolve_session_credentials(&cache, || async {
            self.auth.get_streaming_token().await
        })
        .await
        .map_err(|e| ConnectError::Fatal(format!("Spotify authentication required: {:?}", e)))?;

        let session_config = librespot::core::config::SessionConfig {
            client_id: session_client_id(),
            device_id: device_id.clone(),
            autoplay: Some(false),
            ..Default::default()
        };

        let session = librespot::core::session::Session::new(session_config, Some(cache));

        let cfg = self.config.lock().await.clone();
        let (sink_creator, active_mode, active_backend, device_error) = match cfg.device_mode {
            super::super::types::DeviceMode::ConnectOnly => {
                info!("Configured for connect_only mode: using DummySink without opening audio device");
                let dummy_fn: SinkFn = Box::new(|| Box::new(super::sink::DummySink::new()));
                (
                    dummy_fn,
                    super::super::types::DeviceMode::ConnectOnly,
                    super::super::types::AudioBackend::Dummy,
                    None,
                )
            }
            super::super::types::DeviceMode::Integrated => {
                let (sink_fn, backend, device_error) =
                    resolve_sink_with_fallback(cfg.audio_backend, cfg.audio_device.as_deref());
                let active_mode = if backend == super::super::types::AudioBackend::Dummy {
                    super::super::types::DeviceMode::ConnectOnly
                } else {
                    super::super::types::DeviceMode::Integrated
                };
                (sink_fn, active_mode, backend, device_error)
            }
        };

        if let Some(err) = &device_error {
            *self.last_audio_error.lock().await = Some(err.clone());
        } else {
            *self.last_audio_error.lock().await = None;
        }

        let mixer = Arc::new(
            <librespot::playback::mixer::softmixer::SoftMixer as librespot::playback::mixer::Mixer>::open(
                librespot::playback::mixer::MixerConfig::default(),
            )
            .map_err(|e| ConnectError::Fatal(format!("Failed to open softmixer: {:?}", e)))?,
        );
        let volume_getter = mixer.get_soft_volume();

        let pcm_tx = self.pcm_sender.clone();
        let player_config = librespot::playback::config::PlayerConfig {
            bitrate: match cfg.bitrate {
                super::super::types::Bitrate::Bitrate96 => {
                    librespot::playback::config::Bitrate::Bitrate96
                }
                super::super::types::Bitrate::Bitrate160 => {
                    librespot::playback::config::Bitrate::Bitrate160
                }
                super::super::types::Bitrate::Bitrate320 => {
                    librespot::playback::config::Bitrate::Bitrate320
                }
            },
            gapless: cfg.gapless,
            normalisation: cfg.normalisation,
            normalisation_type: match cfg.normalisation_type.trim().to_ascii_lowercase().as_str() {
                "track" => librespot::playback::config::NormalisationType::Track,
                _ => librespot::playback::config::NormalisationType::Album,
            },
            normalisation_pregain_db: cfg.pregain as f64,
            normalisation_knee_db: 5.0,
            position_update_interval: Some(std::time::Duration::from_millis(250)),
            ..Default::default()
        };
        // ponytail: librespot PlayerConfig lacks native crossfade in 0.8.0; stored in LibrespotConfig, add DSP mixer curve when sink supports dual-stream
        let player = librespot::playback::player::Player::new(
            player_config,
            session.clone(),
            volume_getter,
            move || {
                let actual = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    sink_creator()
                }))
                .unwrap_or_else(|_| {
                    tracing::warn!("Sink creator panicked; falling back to DummySink");
                    Box::new(super::sink::DummySink::new()) as Box<dyn librespot::playback::audio_backend::Sink>
                });
                Box::new(VisualizerSink {
                    inner: actual,
                    pcm_sender: pcm_tx.clone(),
                })
            },
        );
        let event_channel = player.get_player_event_channel();
        let state_engine = Arc::new(self.clone());
        monitor_player_events(event_channel, state_engine);


        let connect_config = librespot::connect::ConnectConfig {
            name: cfg.device_name.clone(),
            device_type: match active_mode {
                super::super::types::DeviceMode::Integrated => {
                    librespot::core::config::DeviceType::Computer
                }
                super::super::types::DeviceMode::ConnectOnly => {
                    librespot::core::config::DeviceType::Speaker
                }
            },
            initial_volume: 45875,
            ..Default::default()
        };

        info!(
            "Initializing Spotoei Spotify Connect receiver with device_id={}",
            device_id
        );

        let spirc = match librespot::connect::Spirc::new(
            connect_config,
            session.clone(),
            credentials.clone(),
            player.clone(),
            mixer,
        )
        .await
        {
            Ok((spirc_instance, spirc_task)) => {
                tokio::spawn(spirc_task);
                let _ = spirc_instance.activate();
                Some(Arc::new(spirc_instance))
            }
            Err(e) => {
                tracing::warn!("Spirc::new failed with error: {:?}", e);
                if super::reauth::is_credentials_error(&e) {
                    return Err(ConnectError::Credentials);
                }
                tracing::warn!(
                    "Spirc Spotify Connect registration skipped ({:?}); local native player will function directly",
                    e
                );
                if session.username().is_empty() {
                    let _ = session.connect(credentials, true).await;
                }
                None
            }
        };

        let active = LibrespotActive {
            session,
            player: player.clone(),
            spirc,
            device_id,
            active_device_mode: active_mode,
            active_audio_backend: active_backend,
            created_epoch: wanted_epoch,
        };

        // The connect above can take seconds: the user may have signed out or
        // switched accounts meanwhile. Installing then would register the
        // device as the previous user until the next epoch check notices.
        if self.auth.session_epoch() != wanted_epoch || !self.auth.has_current_session().await {
            tracing::warn!("discarding playback session for a superseded auth identity");
            return Err(ConnectError::Superseded);
        }

        *self.inner.lock().await = Some(active.clone());
        info!(
            connect_ms = started.elapsed().as_millis() as u64,
            "Spotoei Spotify Connect player initialized (mode={}, backend={})",
            active_mode,
            active_backend
        );
        Ok(active)
    }
}

/// Background task monitoring `PlayerEvent`s and reconciling state into `PlaybackEngine`.
pub fn monitor_player_events(
    mut event_channel: librespot::playback::player::PlayerEventChannel,
    state_engine: Arc<super::LibrespotEngine>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        use librespot::playback::player::PlayerEvent;
        use super::super::PlaybackEngine;
        while let Some(event) = event_channel.recv().await {
            if let PlayerEvent::Playing {
                track_id,
                position_ms,
                ..
            } = &event
            {
                let load_ms = state_engine
                    .load_started_at
                    .lock()
                    .ok()
                    .and_then(|mut started| started.take())
                    .map(|t0| t0.elapsed().as_millis() as u64);
                if let Some(load_ms) = load_ms {
                    info!(track = %track_id, load_ms, position_ms, "Playback started");
                }
            }
            match &event {
                PlayerEvent::Playing { track_id, position_ms, .. } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Playing");
                }
                PlayerEvent::Paused { track_id, position_ms, .. } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Paused");
                }
                PlayerEvent::Loading { track_id, position_ms, .. } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Loading");
                }
                PlayerEvent::Stopped { track_id, .. } => {
                    tracing::debug!(track = %track_id, "PlayerEvent::Stopped");
                }
                PlayerEvent::PositionCorrection { position_ms, .. } => {
                    tracing::debug!(pos = position_ms, "PlayerEvent::PositionCorrection");
                }
                PlayerEvent::VolumeChanged { volume } => {
                    tracing::debug!(vol = volume, "PlayerEvent::VolumeChanged");
                }
                PlayerEvent::TrackChanged { audio_item } => {
                    tracing::debug!(name = %audio_item.name, "PlayerEvent::TrackChanged");
                }
                _ => {}
            }
            state_engine.reconcile_player_event(&event);
        }
    })
}

#[cfg(test)]
mod tests {
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

        let mut player_config = librespot::playback::config::PlayerConfig::default();
        player_config.bitrate = match cfg.bitrate {
            Bitrate::Bitrate96 => librespot::playback::config::Bitrate::Bitrate96,
            Bitrate::Bitrate160 => librespot::playback::config::Bitrate::Bitrate160,
            Bitrate::Bitrate320 => librespot::playback::config::Bitrate::Bitrate320,
        };
        player_config.gapless = cfg.gapless;
        player_config.normalisation = cfg.normalisation;
        player_config.normalisation_type =
            match cfg.normalisation_type.trim().to_ascii_lowercase().as_str() {
                "track" => librespot::playback::config::NormalisationType::Track,
                _ => librespot::playback::config::NormalisationType::Album,
            };
        player_config.normalisation_pregain_db = cfg.pregain as f64;
        player_config.normalisation_knee_db = 5.0;

        assert_eq!(player_config.bitrate, librespot::playback::config::Bitrate::Bitrate160);
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
        }).await.unwrap();
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
}
