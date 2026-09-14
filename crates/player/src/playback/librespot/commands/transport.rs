use crate::playback::librespot::LibrespotEngine;
use crate::playback::types::RepeatMode;

// Transport/queue controls extracted from `commands.rs` for the 300 LoC cap.
impl LibrespotEngine {
    pub(super) fn resume_impl(&self) {
        if self.is_stopped.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::debug!("ignoring resume(): player is in stopped state");
            return;
        }
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                act.player.play();
            }
        });
    }

    pub(super) fn pause_impl(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                act.player.pause();
            }
        });
    }

    pub(super) fn stop_impl(&self) {
        self.is_stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.pause();
                }
                act.player.stop();
            }
        });
    }

    pub(super) fn release_impl(&self) {
        self.is_stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let active = inner.lock().await.take();
            if let Some(active) = active {
                if let Some(spirc) = active.spirc {
                    let _ = spirc.shutdown();
                }
                active.player.stop();
                active.session.shutdown();
            }
        });
    }

    pub(super) fn seek_impl(&self, position_ms: u32) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.set_position_ms(position_ms);
                }
                act.player.seek(position_ms);
            }
        });
    }

    pub(super) fn set_volume_impl(&self, volume: f32) {
        let inner = self.inner.clone();
        let vol_u16 = (volume * 65535.0).clamp(0.0, 65535.0) as u16;
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.set_volume(vol_u16);
                }
                act.player.emit_volume_changed_event(vol_u16);
            }
        });
    }

    pub(super) fn next_impl(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.next();
                }
            }
        });
    }

    pub(super) fn previous_impl(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.prev();
                }
            }
        });
    }

    pub(super) fn set_shuffle_impl(&self, shuffle: bool) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    let _ = spirc.shuffle(shuffle);
                }
            }
        });
    }

    pub(super) fn set_repeat_impl(&self, mode: RepeatMode) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                if let Some(spirc) = &act.spirc {
                    match mode {
                        RepeatMode::Off => {
                            let _ = spirc.repeat(false);
                            let _ = spirc.repeat_track(false);
                        }
                        RepeatMode::Context => {
                            let _ = spirc.repeat(true);
                            let _ = spirc.repeat_track(false);
                        }
                        RepeatMode::Track => {
                            let _ = spirc.repeat_track(true);
                        }
                    }
                }
            }
        });
    }
}
