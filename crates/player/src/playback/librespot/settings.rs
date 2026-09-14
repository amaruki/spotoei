use crate::playback::types::{AudioBackend, Bitrate, DeviceMode, LibrespotConfig};

use super::LibrespotEngine;

// Audio/device configuration accessors extracted from `mod.rs` for the
// 300 LoC cap. Fields stay on the struct in `mod.rs`.
impl LibrespotEngine {
    pub async fn config(&self) -> LibrespotConfig {
        self.config.lock().await.clone()
    }

    pub async fn device_mode(&self) -> DeviceMode {
        self.config.lock().await.device_mode
    }

    pub async fn set_device_mode(&self, mode: DeviceMode) {
        let mut cfg = self.config.lock().await;
        cfg.device_mode = mode;
    }

    pub async fn audio_backend(&self) -> AudioBackend {
        self.config.lock().await.audio_backend
    }

    pub async fn set_audio_backend(&self, backend: AudioBackend) {
        let mut cfg = self.config.lock().await;
        cfg.audio_backend = backend;
    }

    pub async fn bitrate(&self) -> Bitrate {
        self.config.lock().await.bitrate
    }

    pub async fn set_bitrate(&self, bitrate: Bitrate) {
        let mut cfg = self.config.lock().await;
        cfg.bitrate = bitrate;
    }

    pub async fn crossfade_duration_ms(&self) -> u32 {
        self.config.lock().await.crossfade_duration_ms
    }

    pub async fn set_crossfade_duration_ms(&self, duration_ms: u32) {
        let mut cfg = self.config.lock().await;
        cfg.crossfade_duration_ms = duration_ms.clamp(0, 15_000);
    }

    pub async fn normalisation(&self) -> bool {
        self.config.lock().await.normalisation
    }

    pub async fn set_normalisation(&self, enabled: bool) {
        let mut cfg = self.config.lock().await;
        cfg.normalisation = enabled;
    }

    pub async fn normalisation_type(&self) -> String {
        self.config.lock().await.normalisation_type.clone()
    }

    pub async fn set_normalisation_type(&self, norm_type: &str) {
        let mut cfg = self.config.lock().await;
        cfg.normalisation_type = match norm_type.trim().to_ascii_lowercase().as_str() {
            "track" => "track".to_string(),
            _ => "album".to_string(),
        };
    }

    pub async fn pregain(&self) -> f32 {
        self.config.lock().await.pregain
    }

    pub async fn set_pregain(&self, pregain: f32) {
        let mut cfg = self.config.lock().await;
        cfg.pregain = if pregain.is_nan() {
            0.0
        } else {
            pregain.clamp(-20.0, 20.0)
        };
    }

    pub async fn last_audio_error(&self) -> Option<String> {
        self.last_audio_error.lock().await.clone()
    }
}
