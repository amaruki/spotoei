//! Playback Core.
//!
//! Wraps a `PlaybackEngine` (fake/librespot later) behind a state machine
//! and produces the `playback.changed` / `playback.position` events consumed
//! by the TUI. No librespot internals leak out of the player process; the
//! surface is the wire schema only.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};

use crate::event;

const POSITION_EVENT_PERIOD_MS: u64 = 200; // 5 Hz

/// Authoritative UI-facing playback state. Stable, compact, additive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackState {
    Idle,
    Loading,
    Buffering,
    Playing,
    Paused,
    Reconnecting,
    Error,
}

impl PlaybackState {
    fn as_str(self) -> &'static str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Loading => "loading",
            PlaybackState::Buffering => "buffering",
            PlaybackState::Playing => "playing",
            PlaybackState::Paused => "paused",
            PlaybackState::Reconnecting => "reconnecting",
            PlaybackState::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    Context,
    Track,
}

impl RepeatMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::Context => "context",
            RepeatMode::Track => "track",
        }
    }

    pub fn from_str(s: &str) -> Option<RepeatMode> {
        match s {
            "off" => Some(RepeatMode::Off),
            "context" => Some(RepeatMode::Context),
            "track" => Some(RepeatMode::Track),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub uri: String,
    pub name: String,
    pub artists: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
struct PlaybackInner {
    revision: u64,
    state: PlaybackState,
    track: Option<Track>,
    context_uri: Option<String>,
    position_ms: u64,
    duration_ms: u64,
    volume: f32,
    shuffle: bool,
    repeat: RepeatMode,
    autoplay: bool,
    last_change_at: Instant,
    last_emitted_position_ms: u64,
}

impl PlaybackInner {
    fn new() -> Self {
        Self {
            revision: 0,
            state: PlaybackState::Idle,
            track: None,
            context_uri: None,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
            autoplay: true,
            last_change_at: Instant::now(),
            last_emitted_position_ms: 0,
        }
    }
}

/// Engine abstraction so the fake implementation can be swapped for the
/// real librespot-driven one in a future milestone.
pub trait PlaybackEngine: Send + Sync {
    fn resolve_track(&self, uri: &str) -> Option<Track>;
    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
    }
}

/// Deterministic fake engine used for headless tests and UI development
/// until the real librespot path lands.
#[derive(Debug, Default)]
pub struct FakeEngine;

impl PlaybackEngine for FakeEngine {
    fn resolve_track(&self, uri: &str) -> Option<Track> {
        if !uri.starts_with("spotify:track:") {
            return None;
        }
        if uri.len() > 256 {
            return None;
        }
        let id = uri.trim_start_matches("spotify:track:");
        if id.is_empty() || id.len() > 64 {
            return None;
        }
        Some(Track {
            uri: uri.to_string(),
            name: format!("Track {id}"),
            artists: vec!["Test Artist".to_string()],
            album: Some("Test Album".to_string()),
            duration_ms: 240_000,
        })
    }
    fn context_tracks(&self, context_uri: &str) -> Vec<Track> {
        if !context_uri.starts_with("spotify:") {
            return Vec::new();
        }
        (1..=3)
            .map(|i| Track {
                uri: format!("spotify:track:ctx-{}-{}", context_uri, i),
                name: format!("Context Track {i}"),
                artists: vec!["Test Artist".to_string()],
                album: Some("Test Album".to_string()),
                duration_ms: 180_000,
            })
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlaybackError;

pub struct Playback<E: PlaybackEngine + 'static> {
    engine: Arc<E>,
    inner: Arc<Mutex<PlaybackInner>>,
    seq: Arc<Mutex<u64>>,
    events: mpsc::Sender<String>,
}

impl<E: PlaybackEngine + 'static> Clone for Playback<E> {
    fn clone(&self) -> Self {
        Self {
            engine: Arc::clone(&self.engine),
            inner: Arc::clone(&self.inner),
            seq: Arc::clone(&self.seq),
            events: self.events.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackChangedPayload {
    pub revision: u64,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<Track>,
    #[serde(rename = "positionMs")]
    pub position_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: String,
    pub autoplay: bool,
    #[serde(rename = "observedAtMonotonicMs")]
    pub observed_at_monotonic_ms: u64,
}

impl<E: PlaybackEngine + 'static> Playback<E> {
    pub fn new(engine: E, events: mpsc::Sender<String>) -> Self {
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

    fn snapshot_locked(&self, inner: &PlaybackInner) -> PlaybackChangedPayload {
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

    pub async fn load(
        &self,
        context_uri: Option<&str>,
        track_uri: Option<&str>,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let track: Option<Track> = if let Some(tu) = track_uri {
            self.engine.resolve_track(tu)
        } else if let Some(cu) = context_uri {
            self.engine.context_tracks(cu).into_iter().next()
        } else {
            return Err(PlaybackError);
        };
        let track = match track {
            Some(t) => t,
            None => return Err(PlaybackError),
        };
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            inner.state = PlaybackState::Loading;
            inner.track = Some(track.clone());
            inner.context_uri = context_uri.map(|s| s.to_string());
            inner.position_ms = 0;
            inner.duration_ms = track.duration_ms;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn play(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            if inner.state != PlaybackState::Playing {
                inner.revision = inner.revision.wrapping_add(1);
                inner.state = PlaybackState::Playing;
                inner.last_change_at = Instant::now();
            }
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn pause(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            if inner.state == PlaybackState::Playing {
                inner.revision = inner.revision.wrapping_add(1);
                inner.state = PlaybackState::Paused;
                inner.last_change_at = Instant::now();
            }
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn toggle(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            let new_state = if inner.state == PlaybackState::Playing {
                PlaybackState::Paused
            } else {
                PlaybackState::Playing
            };
            if inner.state != new_state {
                inner.revision = inner.revision.wrapping_add(1);
                inner.state = new_state;
                inner.last_change_at = Instant::now();
            }
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn next(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            inner.revision = inner.revision.wrapping_add(1);
            if let Some(ctx) = inner.context_uri.as_deref() {
                let current_uri = inner
                    .track
                    .as_ref()
                    .map(|t| t.uri.clone())
                    .unwrap_or_default();
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
                        }
                    }
                }
            }
            inner.position_ms = 0;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn previous(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            inner.revision = inner.revision.wrapping_add(1);
            if let Some(ctx) = inner.context_uri.as_deref() {
                let current_uri = inner
                    .track
                    .as_ref()
                    .map(|t| t.uri.clone())
                    .unwrap_or_default();
                let tracks = self.engine.context_tracks(ctx);
                if !tracks.is_empty() {
                    let pos = tracks.iter().position(|t| t.uri == current_uri);
                    let prev_pos = match pos {
                        Some(0) => tracks.len() - 1,
                        Some(p) => p - 1,
                        None => tracks.len() - 1,
                    };
                    if let Some(t) = tracks.get(prev_pos) {
                        if let Some(resolved) = self.engine.resolve_track(&t.uri) {
                            inner.track = Some(resolved);
                        }
                    }
                }
            }
            inner.position_ms = 0;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn seek(&self, position_ms: u64) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            inner.revision = inner.revision.wrapping_add(1);
            inner.position_ms = position_ms.min(inner.duration_ms);
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = inner.position_ms;
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_volume(&self, volume: f32) -> Result<PlaybackChangedPayload, PlaybackError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(PlaybackError);
        }
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            inner.volume = volume;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_shuffle(
        &self,
        shuffle: bool,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            inner.shuffle = shuffle;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
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
            inner.revision = inner.revision.wrapping_add(1);
            inner.repeat = mode;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_autoplay(
        &self,
        autoplay: bool,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            inner.autoplay = autoplay;
            inner.last_change_at = Instant::now();
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        Ok(snap)
    }
    /// Tick the position clock forward while playing. Emits a
    /// `playback.position` event at ~5 Hz when the position changed enough
    /// since the last emitted position.
    pub async fn tick(&self) {
        let mut inner = self.inner.lock().await;
        if inner.state != PlaybackState::Playing {
            return;
        }
        let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
        inner.last_change_at = Instant::now();
        let new_pos = inner
            .position_ms
            .saturating_add(elapsed)
            .min(inner.duration_ms);
        inner.position_ms = new_pos;
        let reached_end = inner.duration_ms > 0 && new_pos >= inner.duration_ms;
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

    pub async fn next_seq(&self) -> u64 {
        crate::next_event_seq()
    }

    async fn emit_changed(&self, snap: &PlaybackChangedPayload) {
        let seq = self.next_seq().await;
        let data = serde_json::to_value(snap).unwrap_or(serde_json::Value::Null);
        let line = event("playback.changed", seq, data);
        let _ = self.events.send(line).await;
    }

    async fn emit_position(&self, revision: u64, position_ms: u64) {
        let seq = self.next_seq().await;
        let data = serde_json::json!({
            "revision": revision,
            "positionMs": position_ms,
        });
        let line = event("playback.position", seq, data);
        let _ = self.events.send(line).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_playback_fake_engine_lifecycle() {
        let (tx, mut rx) = mpsc::channel::<String>(16);
        let pb = Playback::new(FakeEngine, tx);

        // Initial state is idle.
        let snap = pb.snapshot().await;
        assert_eq!(snap.state, "idle");
        assert_eq!(snap.revision, 0);
        assert_eq!(snap.position_ms, 0);

        // Load track.
        let load_snap = pb
            .load(None, Some("spotify:track:test12345"))
            .await
            .expect("load should succeed");
        assert_eq!(load_snap.state, "loading");
        assert_eq!(load_snap.revision, 1);
        assert_eq!(
            load_snap.track.as_ref().map(|t| t.name.as_str()),
            Some("Track test12345")
        );

        // Event should be emitted.
        let event = rx.recv().await.expect("playback.changed event");
        assert!(event.contains("playback.changed"));
        assert!(event.contains("loading"));

        // Play.
        let play_snap = pb.play().await.expect("play should succeed");
        assert_eq!(play_snap.state, "playing");
        assert_eq!(play_snap.revision, 2);

        let event = rx.recv().await.expect("playback.changed event");
        assert!(event.contains("playing"));

        // Pause.
        let pause_snap = pb.pause().await.expect("pause should succeed");
        assert_eq!(pause_snap.state, "paused");
        assert_eq!(pause_snap.revision, 3);

        // Toggle back to playing.
        let toggle_snap = pb.toggle().await.expect("toggle should succeed");
        assert_eq!(toggle_snap.state, "playing");
        assert_eq!(toggle_snap.revision, 4);

        // Seek.
        let seek_snap = pb.seek(15_000).await.expect("seek should succeed");
        assert_eq!(seek_snap.position_ms, 15_000);

        // Volume clamping.
        let vol_snap = pb.set_volume(0.5).await.expect("valid volume");
        assert!((vol_snap.volume - 0.5).abs() < 0.001);
        assert!(vol_snap.revision == 6, "set_volume should bump revision");
        let _ = rx.recv().await.expect("set_volume changed event");
        assert!(pb.set_volume(1.2).await.is_err());
        assert!(pb.set_volume(-0.1).await.is_err());

        // Repeat mode validation.
        let rep_snap = pb.set_repeat("context").await.expect("valid repeat");
        assert_eq!(rep_snap.repeat, "context");
        assert!(rep_snap.revision == 7, "set_repeat should bump revision");
        let _ = rx.recv().await.expect("set_repeat changed event");
        assert!(pb.set_repeat("invalid_mode").await.is_err());
    }
}
