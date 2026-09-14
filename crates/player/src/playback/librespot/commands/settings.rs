use crate::playback::librespot::LibrespotEngine;
use crate::playback::types::{AudioBackend, Bitrate, DeviceMode};

// Non-async audio settings accessors extracted from `commands.rs` for the
// 300 LoC cap. These are the lock-free fallbacks used by the sync
// `PlaybackEngine` trait surface; async variants live in `settings.rs`.
impl LibrespotEngine {
    pub(super) fn device_mode_impl(&self) -> DeviceMode {
        if let Ok(guard) = self.config.try_lock() {
            guard.device_mode
        } else {
            DeviceMode::Integrated
        }
    }

    pub(super) fn set_device_mode_impl(&self, mode: DeviceMode) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.device_mode = mode;
        }
    }

    pub(super) fn audio_backend_impl(&self) -> AudioBackend {
        if let Ok(guard) = self.config.try_lock() {
            guard.audio_backend
        } else {
            AudioBackend::Rodio
        }
    }

    pub(super) fn set_audio_backend_impl(&self, backend: AudioBackend) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.audio_backend = backend;
        }
    }

    pub(super) fn bitrate_impl(&self) -> Bitrate {
        if let Ok(guard) = self.config.try_lock() {
            guard.bitrate
        } else {
            Bitrate::Bitrate320
        }
    }

    pub(super) fn set_bitrate_impl(&self, bitrate: Bitrate) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.bitrate = bitrate;
        }
    }

    pub(super) fn crossfade_duration_ms_impl(&self) -> u32 {
        if let Ok(guard) = self.config.try_lock() {
            guard.crossfade_duration_ms
        } else {
            0
        }
    }

    pub(super) fn set_crossfade_duration_ms_impl(&self, duration_ms: u32) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.crossfade_duration_ms = duration_ms.clamp(0, 15_000);
        }
    }

    pub(super) fn normalisation_impl(&self) -> bool {
        if let Ok(guard) = self.config.try_lock() {
            guard.normalisation
        } else {
            true
        }
    }

    pub(super) fn set_normalisation_impl(&self, enabled: bool) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.normalisation = enabled;
        }
    }

    pub(super) fn normalisation_type_impl(&self) -> String {
        if let Ok(guard) = self.config.try_lock() {
            guard.normalisation_type.clone()
        } else {
            "album".to_string()
        }
    }

    pub(super) fn set_normalisation_type_impl(&self, norm_type: &str) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.normalisation_type = match norm_type.trim().to_ascii_lowercase().as_str() {
                "track" => "track".to_string(),
                _ => "album".to_string(),
            };
        }
    }

    pub(super) fn pregain_impl(&self) -> f32 {
        if let Ok(guard) = self.config.try_lock() {
            guard.pregain
        } else {
            0.0
        }
    }

    pub(super) fn set_pregain_impl(&self, pregain: f32) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.pregain = if pregain.is_nan() {
                0.0
            } else {
                pregain.clamp(-20.0, 20.0)
            };
        }
    }
}
