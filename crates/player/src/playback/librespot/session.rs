use std::sync::Arc;
use librespot::playback::mixer::Mixer;

use tracing::info;

use super::sink::VisualizerSink;

#[derive(Clone)]
pub struct LibrespotActive {
    pub _session: librespot::core::session::Session,
    pub player: Arc<librespot::playback::player::Player>,
    pub spirc: Arc<librespot::connect::Spirc>,
    pub _device_id: String,
}

impl super::LibrespotEngine {
    pub async fn ensure_player(&self) -> Result<Arc<librespot::playback::player::Player>, String> {
        let act = self.ensure_active().await?;
        Ok(act.player)
    }

    pub(super) async fn ensure_active(&self) -> Result<LibrespotActive, String> {
        let mut guard = self.inner.lock().await;
        if let Some(ref act) = *guard {
            return Ok(act.clone());
        }

        let config_dir = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".config"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
            })
            .join("spotoei");
        let cache_dir = config_dir.join("cache");
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
        .map_err(|e| format!("Failed to create librespot cache: {:?}", e))?;

        let credentials = if let Some(creds) = cache.credentials() {
            creds
        } else {
            let (token, _) = self
                .auth
                .get_web_token()
                .await
                .map_err(|e| format!("Spotify authentication required: {:?}", e))?;
            librespot::core::authentication::Credentials::with_access_token(token)
        };

        let session_config = librespot::core::config::SessionConfig {
            device_id: device_id.clone(),
            autoplay: Some(false),
            ..Default::default()
        };

        let session = librespot::core::session::Session::new(session_config, Some(cache));

        let sink_builder = librespot::playback::audio_backend::find(None)
            .ok_or_else(|| "No audio sink backend found for current platform".to_string())?;

        let mixer = Arc::new(
            <librespot::playback::mixer::softmixer::SoftMixer as librespot::playback::mixer::Mixer>::open(
                librespot::playback::mixer::MixerConfig::default(),
            )
            .map_err(|e| format!("Failed to open softmixer: {:?}", e))?,
        );
        let volume_getter = mixer.get_soft_volume();

        let pcm_tx = self.pcm_sender.clone();
        let player_config = librespot::playback::config::PlayerConfig::default();
        let player = librespot::playback::player::Player::new(
            player_config,
            session.clone(),
            volume_getter,
            move || {
                let actual =
                    sink_builder(None, librespot::playback::config::AudioFormat::default());
                Box::new(VisualizerSink {
                    inner: actual,
                    pcm_sender: pcm_tx.clone(),
                })
            },
        );

        let connect_config = librespot::connect::ConnectConfig {
            name: "Spotoei".to_string(),
            device_type: librespot::core::config::DeviceType::Computer,
            initial_volume: 45875,
            ..Default::default()
        };

        info!(
            "Initializing Spotoei Spotify Connect receiver with device_id={}",
            device_id
        );

        let (spirc, spirc_task) = librespot::connect::Spirc::new(
            connect_config,
            session.clone(),
            credentials,
            player.clone(),
            mixer,
        )
        .await
        .map_err(|e| format!("Failed to start Spirc Spotify Connect: {:?}", e))?;

        tokio::spawn(spirc_task);
        let _ = spirc.activate();

        let active = LibrespotActive {
            _session: session,
            player: player.clone(),
            spirc: Arc::new(spirc),
            _device_id: device_id,
        };

        *guard = Some(active.clone());
        info!("Spotoei integrated Spotify Connect player initialized and connected successfully");
        Ok(active)
    }
}
