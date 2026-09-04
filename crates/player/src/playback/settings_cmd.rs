use std::time::Instant;

use super::state::Playback;
use super::types::{
    PlaybackChangedPayload, PlaybackError, PlaybackInner, PlaybackState, RepeatMode,
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
            inner.volume = volume;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.engine.set_volume(volume);
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
            advance_position_if_playing(&mut inner);
            inner.revision = inner.revision.wrapping_add(1);
            inner.autoplay = autoplay;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }
}

fn advance_position_if_playing(inner: &mut PlaybackInner) {
    if inner.state == PlaybackState::Playing {
        let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
        inner.position_ms = inner
            .position_ms
            .saturating_add(elapsed)
            .min(inner.duration_ms);
    }
}
