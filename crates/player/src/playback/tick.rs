use std::time::{Duration, Instant};

use super::state::Playback;
use super::types::PlaybackState;
use super::types::RepeatMode;

const POSITION_EVENT_PERIOD_MS: u64 = 200; // 5 Hz
/// Give up on a load that never reaches Playing/Paused (dead session,
/// silently rejected Connect load, stalled audio key fetch) so the UI does
/// not sit on a loading state forever.
const LOADING_TIMEOUT: Duration = Duration::from_secs(20);

impl Playback {
    /// Tick the position clock forward while playing. Emits a
    /// `playback.position` event at ~5 Hz when the position changed enough
    /// since the last emitted position.
    pub async fn tick(&self) {
        let mut inner = self.inner.lock().await;
        if inner.state != PlaybackState::Playing {
            if inner.state == PlaybackState::Loading
                && inner.last_change_at.elapsed() >= LOADING_TIMEOUT
            {
                inner.state = PlaybackState::Idle;
                inner.position_ms = 0;
                inner.last_change_at = Instant::now();
                inner.revision = inner.revision.wrapping_add(1);
                let snap = self.snapshot_locked(&inner);
                drop(inner);
                self.emit_changed(&snap).await;
            }
            return;
        }
        let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
        inner.last_change_at = Instant::now();
        let new_pos = inner.position_ms.saturating_add(elapsed);
        let clamped_pos = if inner.duration_ms > 0 {
            new_pos.min(inner.duration_ms)
        } else {
            new_pos
        };
        inner.position_ms = clamped_pos;
        // NOTE: `position_ms` is clamped at `duration_ms`, so once the end
        // is reached the stored position stops growing and `new_pos` never
        // passes `duration_ms + 100`. Detect the end from the clamped
        // position as well, otherwise track end is never observed.
        let reached_end = inner.duration_ms > 0
            && (new_pos >= inner.duration_ms.saturating_add(100)
                || inner.position_ms >= inner.duration_ms);
        if reached_end {
            // Honor repeat modes and autoplay rules when track finishes.
            match inner.repeat {
                RepeatMode::Track => {
                    inner.position_ms = 0;
                    inner.last_change_at = Instant::now();
                    inner.last_emitted_position_ms = 0;
                    inner.revision = inner.revision.wrapping_add(1);
                    let snap = self.snapshot_locked(&inner);
                    drop(inner);
                    self.emit_changed(&snap).await;
                    return;
                }
                RepeatMode::Context => {
                    let current_uri = inner
                        .track
                        .as_ref()
                        .map(|t| t.uri.clone())
                        .unwrap_or_default();
                    let mut advanced = false;
                    if let Some(ctx) = inner.context_uri.as_deref() {
                        let tracks = self.engine.context_tracks(ctx);
                        if !tracks.is_empty() {
                            let pos = tracks.iter().position(|t| t.uri == current_uri);
                            let next_pos = match pos {
                                Some(p) => (p + 1) % tracks.len(),
                                None => 0,
                            };
                            if let Some(t) = tracks.get(next_pos) {
                                if let Some(resolved) = self.engine.resolve_track(&t.uri) {
                                    inner.track = Some(resolved);
                                    inner.position_ms = 0;
                                    inner.last_change_at = Instant::now();
                                    inner.last_emitted_position_ms = 0;
                                    advanced = true;
                                }
                            }
                        }
                    }
                    if !advanced {
                        inner.state = PlaybackState::Idle;
                        inner.position_ms = inner.duration_ms;
                    }
                    inner.revision = inner.revision.wrapping_add(1);
                    let snap = self.snapshot_locked(&inner);
                    drop(inner);
                    self.emit_changed(&snap).await;
                    return;
                }
                RepeatMode::Off => {
                    let mut advanced = false;
                    if inner.autoplay {
                        let current_uri = inner
                            .track
                            .as_ref()
                            .map(|t| t.uri.clone())
                            .unwrap_or_default();
                        if let Some(ctx) = inner.context_uri.as_deref() {
                            let tracks = self.engine.context_tracks(ctx);
                            if let Some(pos) = tracks.iter().position(|t| t.uri == current_uri) {
                                if pos + 1 < tracks.len() {
                                    if let Some(t) = tracks.get(pos + 1) {
                                        if let Some(resolved) = self.engine.resolve_track(&t.uri) {
                                            inner.track = Some(resolved);
                                            inner.position_ms = 0;
                                            inner.last_change_at = Instant::now();
                                            inner.last_emitted_position_ms = 0;
                                            advanced = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !advanced {
                        inner.state = PlaybackState::Idle;
                        inner.position_ms = inner.duration_ms;
                    }
                    inner.revision = inner.revision.wrapping_add(1);
                    let snap = self.snapshot_locked(&inner);
                    drop(inner);
                    self.emit_changed(&snap).await;
                    return;
                }
            }
        }
        let should_emit_position = inner
            .position_ms
            .saturating_sub(inner.last_emitted_position_ms)
            >= POSITION_EVENT_PERIOD_MS;
        let revision = inner.revision;
        let snapshot_pos = inner.position_ms;
        if should_emit_position {
            inner.last_emitted_position_ms = inner.position_ms;
        }
        drop(inner);
        if should_emit_position {
            self.emit_position(revision, snapshot_pos).await;
        }
    }
}
