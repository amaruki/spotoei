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
        let engine: Arc<dyn PlaybackEngine> = Arc::new(engine);
        let pb = Self {
            engine: Arc::clone(&engine),
            inner: Arc::new(Mutex::new(PlaybackInner::new())),
            seq: Arc::new(Mutex::new(0)),
            events,
        };
        engine.attach_state_listener(Arc::new(pb.clone()));
        pb
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
            device_mode: Some(inner.device_mode.as_str().to_string()),
            observed_at_monotonic_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }
    }

    pub async fn next_seq(&self) -> u64 {
        crate::next_event_seq()
    }

    pub(super) async fn emit_changed(&self, snap: &PlaybackChangedPayload) {
        let seq = self.next_seq().await;
        let line = format_playback_changed_event(seq, snap);
        let _ = self.events.send(line).await;
    }

    pub(super) async fn emit_position(&self, revision: u64, position_ms: u64) {
        let seq = self.next_seq().await;
        let line = format_playback_position_event(seq, revision, position_ms);
        let _ = self.events.send(line).await;
    }

    pub async fn handle_player_event(&self, event: librespot::playback::player::PlayerEvent) {
        use librespot::playback::player::PlayerEvent;
        match event {
            PlayerEvent::Playing {
                track_id,
                position_ms,
                ..
            } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.state = super::types::PlaybackState::Playing;
                    inner.position_ms = position_ms as u64;
                    inner.last_change_at = std::time::Instant::now();
                    let uri = track_id
                        .to_uri()
                        .unwrap_or_else(|_| format!("spotify:track:{}", track_id));
                    if inner.track.as_ref().map(|t| &t.uri) != Some(&uri) {
                        if let Some(t) = self.engine.resolve_track(&uri) {
                            if t.duration_ms > 0 {
                                inner.duration_ms = t.duration_ms;
                            }
                            inner.track = Some(t);
                        }
                    }
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::Paused { position_ms, .. } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.state = super::types::PlaybackState::Paused;
                    inner.position_ms = position_ms as u64;
                    inner.last_change_at = std::time::Instant::now();
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::Loading {
                position_ms,
                track_id,
                ..
            } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.state = super::types::PlaybackState::Loading;
                    inner.position_ms = position_ms as u64;
                    inner.last_change_at = std::time::Instant::now();
                    let uri = track_id
                        .to_uri()
                        .unwrap_or_else(|_| format!("spotify:track:{}", track_id));
                    if inner.track.as_ref().map(|t| &t.uri) != Some(&uri) {
                        if let Some(t) = self.engine.resolve_track(&uri) {
                            inner.track = Some(t);
                        }
                    }
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::Stopped { .. } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.state = super::types::PlaybackState::Idle;
                    inner.last_change_at = std::time::Instant::now();
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::PositionCorrection { position_ms, .. }
            | PlayerEvent::PositionChanged { position_ms, .. }
            | PlayerEvent::Seeked { position_ms, .. } => {
                let (rev, pos) = {
                    let mut inner = self.inner.lock().await;
                    inner.position_ms = position_ms as u64;
                    inner.last_change_at = std::time::Instant::now();
                    (inner.revision, inner.position_ms)
                };
                self.emit_position(rev, pos).await;
            }
            PlayerEvent::VolumeChanged { volume } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.volume = (volume as f32) / 65535.0;
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::TrackChanged { audio_item } => {
                let uri = audio_item
                    .track_id
                    .to_uri()
                    .unwrap_or_else(|_| audio_item.uri.clone());
                let (artists, album) = match &audio_item.unique_fields {
                    librespot::metadata::audio::item::UniqueFields::Track { artists, album, .. } => (
                        artists.iter().map(|a| a.name.clone()).collect(),
                        Some(album.clone()),
                    ),
                    _ => (vec!["Unknown Artist".to_string()], None),
                };
                let track = super::types::Track {
                    uri,
                    name: audio_item.name.clone(),
                    artists,
                    album,
                    duration_ms: audio_item.duration_ms as u64,
                    genre: None,
                    image_url: audio_item.covers.first().map(|c| c.url.clone()),
                };
                self.engine.remember_track_metadata(&track);
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.track = Some(track);
                    inner.duration_ms = audio_item.duration_ms as u64;
                    inner.position_ms = 0;
                    inner.revision = inner.revision.wrapping_add(1);
                    inner.last_change_at = std::time::Instant::now();
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::ShuffleChanged { shuffle } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.shuffle = shuffle;
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::RepeatChanged { context, track } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.repeat = if track {
                        super::types::RepeatMode::Track
                    } else if context {
                        super::types::RepeatMode::Context
                    } else {
                        super::types::RepeatMode::Off
                    };
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            PlayerEvent::AutoPlayChanged { auto_play } => {
                let snap = {
                    let mut inner = self.inner.lock().await;
                    inner.autoplay = auto_play;
                    inner.revision = inner.revision.wrapping_add(1);
                    self.snapshot_locked(&inner)
                };
                self.emit_changed(&snap).await;
            }
            _ => {}
        }
    }
}

impl super::engine::PlaybackStateListener for Playback {
    fn on_player_event(&self, event: &librespot::playback::player::PlayerEvent) {
        let this = self.clone();
        let event = event.clone();
        tokio::spawn(async move {
            this.handle_player_event(event).await;
        });
    }
}

pub fn format_playback_changed_event(seq: u64, snap: &PlaybackChangedPayload) -> String {
    let data = serde_json::to_value(snap).unwrap_or(serde_json::Value::Null);
    event("playback.changed", seq, data)
}

pub fn format_playback_position_event(seq: u64, revision: u64, position_ms: u64) -> String {
    let data = serde_json::json!({
        "revision": revision,
        "positionMs": position_ms,
    });
    event("playback.position", seq, data)
}
