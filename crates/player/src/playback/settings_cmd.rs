use std::time::Instant;

use super::state::Playback;
use super::types::{
    AudioBackend, Bitrate, DeviceMode, PlaybackChangedPayload, PlaybackError, PlaybackInner,
    PlaybackState, RepeatMode,
};

impl Playback {
    pub async fn set_volume(&self, volume: f32) -> Result<PlaybackChangedPayload, PlaybackError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(PlaybackError);
        }
        let snap = {
            let mut inner = self.inner.lock().await;
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            if inner.muted_volume.is_some() {
                if volume > 0.0 {
                    inner.muted_volume = Some(volume);
                }
            } else {
                inner.volume = volume;
            }
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        let effective_volume = {
            let inner = self.inner.lock().await;
            inner.volume
        };
        self.engine.set_volume(effective_volume);
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn toggle_mute(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            if let Some(prev) = inner.muted_volume.take() {
                inner.volume = prev;
            } else {
                let save = if inner.volume > 0.0 { inner.volume } else { 0.8 };
                inner.muted_volume = Some(save);
                inner.volume = 0.0;
            }
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        let vol = {
            let inner = self.inner.lock().await;
            inner.volume
        };
        self.engine.set_volume(vol);
        self.emit_changed(&snap).await;
        Ok(snap)
    }


    pub async fn set_shuffle(
        &self,
        shuffle: bool,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            inner.shuffle = shuffle;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.engine.set_shuffle(shuffle);
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_repeat(&self, repeat: &str) -> Result<PlaybackChangedPayload, PlaybackError> {
        let mode = match RepeatMode::from_str(repeat) {
            Some(m) => m,
            None => return Err(PlaybackError),
        };
        let snap = {
            let mut inner = self.inner.lock().await;
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            inner.repeat = mode;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.engine.set_repeat(mode);
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_autoplay(
        &self,
        autoplay: bool,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            // Do not emit when nothing changed. The dispatcher calls this
            // before every `load`, and emitting the pre-load snapshot here
            // (often a stale `idle` from the previous track) makes the TUI
            // auto-advance spuriously, chaining loads forever.
            if inner.autoplay == autoplay {
                return Ok(self.snapshot_locked(&inner));
            }
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            inner.autoplay = autoplay;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_device_mode(&self, mode: DeviceMode) -> PlaybackChangedPayload {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.device_mode == mode {
                return self.snapshot_locked(&inner);
            }
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            inner.device_mode = mode;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.engine.set_device_mode(mode);
        self.emit_changed(&snap).await;
        snap
    }

    pub async fn device_mode(&self) -> DeviceMode {
        let inner = self.inner.lock().await;
        inner.device_mode
    }

    pub async fn set_audio_backend(&self, backend: AudioBackend) -> AudioBackend {
        {
            let mut inner = self.inner.lock().await;
            inner.audio_backend = backend;
        }
        self.engine.set_audio_backend(backend);
        backend
    }

    pub async fn audio_backend(&self) -> AudioBackend {
        let inner = self.inner.lock().await;
        inner.audio_backend
    }

    pub async fn set_bitrate(&self, bitrate: Bitrate) -> Bitrate {
        {
            let mut inner = self.inner.lock().await;
            inner.bitrate = bitrate;
        }
        self.engine.set_bitrate(bitrate);
        bitrate
    }

    pub async fn bitrate(&self) -> Bitrate {
        let inner = self.inner.lock().await;
        inner.bitrate
    }

    pub async fn set_crossfade_duration_ms(&self, duration_ms: u32) -> u32 {
        let clamped = duration_ms.clamp(0, 15_000);
        {
            let mut inner = self.inner.lock().await;
            inner.crossfade_duration_ms = clamped;
        }
        self.engine.set_crossfade_duration_ms(clamped);
        clamped
    }

    pub async fn crossfade_duration_ms(&self) -> u32 {
        let inner = self.inner.lock().await;
        inner.crossfade_duration_ms
    }

    pub async fn set_normalisation(&self, enabled: bool) -> bool {
        {
            let mut inner = self.inner.lock().await;
            inner.normalisation = enabled;
        }
        self.engine.set_normalisation(enabled);
        enabled
    }

    pub async fn normalisation(&self) -> bool {
        let inner = self.inner.lock().await;
        inner.normalisation
    }

    pub async fn set_normalisation_type(&self, norm_type: &str) -> String {
        let val = match norm_type.trim().to_ascii_lowercase().as_str() {
            "track" => "track".to_string(),
            _ => "album".to_string(),
        };
        {
            let mut inner = self.inner.lock().await;
            inner.normalisation_type.clone_from(&val);
        }
        self.engine.set_normalisation_type(&val);
        val
    }

    pub async fn normalisation_type(&self) -> String {
        let inner = self.inner.lock().await;
        inner.normalisation_type.clone()
    }

    pub async fn set_pregain(&self, pregain: f32) -> f32 {
        let clamped = if pregain.is_nan() {
            0.0
        } else {
            pregain.clamp(-20.0, 20.0)
        };
        {
            let mut inner = self.inner.lock().await;
            inner.pregain = clamped;
        }
        self.engine.set_pregain(clamped);
        clamped
    }
    pub async fn pregain(&self) -> f32 {
        let inner = self.inner.lock().await;
        inner.pregain
    }
}

pub(super) fn advance_position_if_playing(inner: &mut PlaybackInner) {
    if inner.state == PlaybackState::Playing {
        let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
        inner.position_ms = inner
            .position_ms
            .saturating_add(elapsed)
            .min(inner.duration_ms);
    }
}
