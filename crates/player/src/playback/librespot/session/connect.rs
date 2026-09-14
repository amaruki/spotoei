use std::sync::Arc;

use librespot::playback::mixer::Mixer;
use tracing::info;

use super::super::reauth;
use super::super::sink::{DummySink, VisualizerSink};
use super::{
    monitor_player_events, resolve_session_credentials, resolve_sink_with_fallback,
    session_client_id, ConnectError, LibrespotActive, SinkFn,
};
use crate::playback::types::{AudioBackend, Bitrate, DeviceMode};

impl super::super::LibrespotEngine {
    /// Build a fresh librespot session. A credentials rejection is reported
    /// distinctly so the caller can retry once with a fresh token; every
    /// other outcome (including the Spirc-less fallback) resolves here.
    pub(super) async fn connect_active(
        &self,
        wanted_epoch: u64,
    ) -> Result<LibrespotActive, ConnectError> {
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

        let (credentials, _used_cache) =
            resolve_session_credentials(&cache, || async { self.auth.get_streaming_token().await })
                .await
                .map_err(|e| {
                    ConnectError::Fatal(format!("Spotify authentication required: {:?}", e))
                })?;

        let session_config = librespot::core::config::SessionConfig {
            client_id: session_client_id(),
            device_id: device_id.clone(),
            autoplay: Some(false),
            ..Default::default()
        };

        let session = librespot::core::session::Session::new(session_config, Some(cache));

        let cfg = self.config.lock().await.clone();
        let (sink_creator, active_mode, active_backend, device_error) = match cfg.device_mode {
            DeviceMode::ConnectOnly => {
                info!("Configured for connect_only mode: using DummySink without opening audio device");
                let dummy_fn: SinkFn = Box::new(|| Box::new(DummySink::new()));
                (dummy_fn, DeviceMode::ConnectOnly, AudioBackend::Dummy, None)
            }
            DeviceMode::Integrated => {
                let (sink_fn, backend, device_error) =
                    resolve_sink_with_fallback(cfg.audio_backend, cfg.audio_device.as_deref());
                let active_mode = if backend == AudioBackend::Dummy {
                    DeviceMode::ConnectOnly
                } else {
                    DeviceMode::Integrated
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
            position_update_interval: Some(std::time::Duration::from_millis(250)),
            ..Default::default()
        };
        // ponytail: librespot PlayerConfig lacks native crossfade in 0.8.0; stored in LibrespotConfig, add DSP mixer curve when sink supports dual-stream
        let player = librespot::playback::player::Player::new(
            player_config,
            session.clone(),
            volume_getter,
            move || {
                let actual = std::panic::catch_unwind(std::panic::AssertUnwindSafe(sink_creator))
                    .unwrap_or_else(|_| {
                        tracing::warn!("Sink creator panicked; falling back to DummySink");
                        Box::new(DummySink::new())
                            as Box<dyn librespot::playback::audio_backend::Sink>
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
                DeviceMode::Integrated => librespot::core::config::DeviceType::Computer,
                DeviceMode::ConnectOnly => librespot::core::config::DeviceType::Speaker,
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
                if reauth::is_credentials_error(&e) {
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
