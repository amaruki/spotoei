use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use crate::event;

use super::engine::PlaybackEngine;
use super::types::{PlaybackChangedPayload, PlaybackInner};

pub struct Playback {
    pub(super) engine: Arc<dyn PlaybackEngine>,
    pub(super) inner: Arc<Mutex<PlaybackInner>>,
    pub(super) seq: Arc<Mutex<u64>>,
    pub(super) events: mpsc::Sender<String>,
}

impl Clone for Playback {
    fn clone(&self) -> Self {
        Self {
            engine: Arc::clone(&self.engine),
            inner: Arc::clone(&self.inner),
            seq: Arc::clone(&self.seq),
            events: self.events.clone(),
        }
    }
}

impl Playback {
    pub fn new(engine: impl PlaybackEngine + 'static, events: mpsc::Sender<String>) -> Self {
        Self {
            engine: Arc::new(engine),
            inner: Arc::new(Mutex::new(PlaybackInner::new())),
            seq: Arc::new(Mutex::new(0)),
            events,
        }
    }

    pub async fn snapshot(&self) -> PlaybackChangedPayload {
        let inner = self.inner.lock().await;
        self.snapshot_locked(&inner)
    }

    pub(super) fn snapshot_locked(&self, inner: &PlaybackInner) -> PlaybackChangedPayload {
        PlaybackChangedPayload {
            revision: inner.revision,
            state: inner.state.as_str().to_string(),
            track: inner.track.clone(),
            position_ms: inner.position_ms,
            duration_ms: inner.duration_ms,
            volume: inner.volume,
            shuffle: inner.shuffle,
            repeat: inner.repeat.as_str().to_string(),
            autoplay: inner.autoplay,
            observed_at_monotonic_ms: inner.last_change_at.elapsed().as_millis() as u64,
        }
    }

    pub async fn next_seq(&self) -> u64 {
        crate::next_event_seq()
    }

    pub(super) async fn emit_changed(&self, snap: &PlaybackChangedPayload) {
        let seq = self.next_seq().await;
        let data = serde_json::to_value(snap).unwrap_or(serde_json::Value::Null);
        let line = event("playback.changed", seq, data);
        let _ = self.events.send(line).await;
    }

    pub(super) async fn emit_position(&self, revision: u64, position_ms: u64) {
        let seq = self.next_seq().await;
        let data = serde_json::json!({
            "revision": revision,
            "positionMs": position_ms,
        });
        let line = event("playback.position", seq, data);
        let _ = self.events.send(line).await;
    }
}
