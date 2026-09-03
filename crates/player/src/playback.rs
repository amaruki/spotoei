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
use tracing::{info, warn};
use librespot::playback::mixer::Mixer;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
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
    fn play_track(&self, _uri: &str, _autoplay: bool, _position_ms: u32) {}
    fn resume(&self) {}
    fn pause(&self) {}
    fn stop(&self) {}
    fn seek(&self, _position_ms: u32) {}
    fn set_volume(&self, _volume: f32) {}
    fn next(&self) {}
    fn previous(&self) {}
    fn set_shuffle(&self, _shuffle: bool) {}
    fn set_repeat(&self, _mode: RepeatMode) {}
    fn remember_track_metadata(&self, _track: &Track) {}
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
            genre: None,
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
                genre: None,
            })
            .collect()
    }
}

/// Real audio playback engine driven by Librespot and native Rodio audio sink.
#[derive(Clone)]
pub struct LibrespotEngine {
    auth: Arc<crate::auth::AuthManager>,
    inner: Arc<Mutex<Option<LibrespotActive>>>,
    track_metadata_cache: Arc<Mutex<std::collections::HashMap<String, Track>>>,
    pcm_sender: crossbeam_channel::Sender<Vec<f32>>,
    pcm_receiver: crossbeam_channel::Receiver<Vec<f32>>,
}

#[derive(Clone)]
struct LibrespotActive {
    _session: librespot::core::session::Session,
    player: Arc<librespot::playback::player::Player>,
    spirc: Arc<librespot::connect::Spirc>,
    _device_id: String,
}

pub struct VisualizerSink {
    inner: Box<dyn librespot::playback::audio_backend::Sink>,
    pcm_sender: crossbeam_channel::Sender<Vec<f32>>,
}

impl librespot::playback::audio_backend::Sink for VisualizerSink {
    fn start(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.inner.start()
    }

    fn stop(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.inner.stop()
    }

    fn write(
        &mut self,
        packet: librespot::playback::decoder::AudioPacket,
        converter: &mut librespot::playback::convert::Converter,
    ) -> librespot::playback::audio_backend::SinkResult<()> {
        if let Ok(samples) = packet.samples() {
            let mut mono = Vec::with_capacity(samples.len() / 2);
            for chunk in samples.chunks_exact(2) {
                mono.push(0.5 * (chunk[0] as f32 + chunk[1] as f32));
            }
            if !mono.is_empty() {
                let _ = self.pcm_sender.try_send(mono);
            }
        }
        self.inner.write(packet, converter)
    }
}

impl LibrespotEngine {
    pub fn new(auth: Arc<crate::auth::AuthManager>) -> Self {
        let (pcm_sender, pcm_receiver) = crossbeam_channel::bounded(64);
        Self {
            auth,
            inner: Arc::new(Mutex::new(None)),
            track_metadata_cache: Arc::new(Mutex::new(std::collections::HashMap::new())),
            pcm_sender,
            pcm_receiver,
        }
    }

    pub fn pcm_receiver(&self) -> crossbeam_channel::Receiver<Vec<f32>> {
        self.pcm_receiver.clone()
    }

    async fn ensure_active(&self) -> Result<LibrespotActive, String> {
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
        ).map_err(|e| format!("Failed to create librespot cache: {:?}", e))?;

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
        // Uses default KEYMASTER_CLIENT_ID for full Spotify Connect streaming

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
                let actual = sink_builder(None, librespot::playback::config::AudioFormat::default());
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

        info!("Initializing Spotoei Spotify Connect receiver with device_id={}", device_id);

        let (spirc, spirc_task) = librespot::connect::Spirc::new(
            connect_config,
            session.clone(),
            credentials,
            player.clone(),
            mixer,
        ).await.map_err(|e| format!("Failed to start Spirc Spotify Connect: {:?}", e))?;

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

    pub async fn ensure_player(&self) -> Result<Arc<librespot::playback::player::Player>, String> {
        let act = self.ensure_active().await?;
        Ok(act.player)
    }
}

impl PlaybackEngine for LibrespotEngine {
    fn remember_track_metadata(&self, track: &Track) {
        if let Ok(mut cache) = self.track_metadata_cache.try_lock() {
            cache.insert(track.uri.clone(), track.clone());
        }
    }

    fn resolve_track(&self, uri: &str) -> Option<Track> {
        if !uri.starts_with("spotify:track:") {
            return None;
        }
        if let Ok(cache) = self.track_metadata_cache.try_lock() {
            if let Some(t) = cache.get(uri) {
                return Some(t.clone());
            }
        }
        let id = uri.trim_start_matches("spotify:track:");
        if id.is_empty() || id.len() > 64 {
            return None;
        }
        Some(Track {
            uri: uri.to_string(),
            name: format!("Track {id}"),
            artists: vec!["Unknown Artist".to_string()],
            album: None,
            duration_ms: 240_000,
            genre: None,
        })
    }

    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
    }

    fn play_track(&self, uri: &str, autoplay: bool, position_ms: u32) {
        let self_clone = self.clone();
        let uri_str = uri.to_string();
        tokio::spawn(async move {
            match self_clone.ensure_active().await {
                Ok(act) => {
                    info!("Spotoei playing track: {}", uri_str);
                    let options = librespot::connect::LoadRequestOptions {
                        start_playing: autoplay,
                        seek_to: position_ms,
                        ..Default::default()
                    };
                    let req = librespot::connect::LoadRequest::from_tracks(vec![uri_str.clone()], options);
                    if let Err(e) = act.spirc.load(req) {
                        warn!("Spirc load failed, fallback to direct player: {:?}", e);
                        if let Ok(sp_uri) = librespot::core::spotify_uri::SpotifyUri::from_uri(&uri_str) {
                            act.player.load(sp_uri, autoplay, position_ms);
                        }
                    }
                }
                Err(e) => {
                    warn!("Librespot playback unavailable: {}", e);
                }
            }
        });
    }

    fn pause(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.pause();
            }
        });
    }

    fn stop(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.pause();
                act.player.stop();
            }
        });
    }

    fn seek(&self, position_ms: u32) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.set_position_ms(position_ms);
                act.player.seek(position_ms);
            }
        });
    }

    fn set_volume(&self, volume: f32) {
        let inner = self.inner.clone();
        let vol_u16 = (volume * 65535.0).clamp(0.0, 65535.0) as u16;
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.set_volume(vol_u16);
                act.player.emit_volume_changed_event(vol_u16);
            }
        });
    }

    fn next(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.next();
            }
        });
    }

    fn previous(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.prev();
            }
        });
    }

    fn set_shuffle(&self, shuffle: bool) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                let _ = act.spirc.shuffle(shuffle);
            }
        });
    }

    fn set_repeat(&self, mode: RepeatMode) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Some(ref act) = *inner.lock().await {
                match mode {
                    RepeatMode::Off => {
                        let _ = act.spirc.repeat(false);
                        let _ = act.spirc.repeat_track(false);
                    }
                    RepeatMode::Context => {
                        let _ = act.spirc.repeat(true);
                        let _ = act.spirc.repeat_track(false);
                    }
                    RepeatMode::Track => {
                        let _ = act.spirc.repeat_track(true);
                    }
                }
            }
        });
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlaybackError;

/// Input for `Playback::load`. Bundled into a struct so the call site does
/// not have to remember positional argument order, and so clippy does not
/// flag the function for exceeding the 7-argument heuristic.
#[derive(Debug, Default, Clone)]
pub struct LoadRequest<'a> {
    pub context_uri: Option<&'a str>,
    pub track_uri: Option<&'a str>,
    pub name: Option<&'a str>,
    pub artists: Option<Vec<String>>,
    pub album: Option<&'a str>,
    pub duration_ms: Option<u64>,
    pub genre: Option<&'a str>,
}

pub struct Playback {
    engine: Arc<dyn PlaybackEngine>,
    inner: Arc<Mutex<PlaybackInner>>,
    seq: Arc<Mutex<u64>>,
    events: mpsc::Sender<String>,
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

    pub async fn load(&self, req: LoadRequest<'_>) -> Result<PlaybackChangedPayload, PlaybackError> {
        let track: Option<Track> = if let Some(tu) = req.track_uri {
            let mut resolved = self.engine.resolve_track(tu);
            if let Some(ref mut t) = resolved {
                if let Some(n) = req.name {
                    if !n.trim().is_empty() {
                        t.name = n.trim().to_string();
                    }
                }
                if let Some(a) = req.artists {
                    if !a.is_empty() {
                        t.artists = a;
                    }
                }
                if let Some(alb) = req.album {
                    if !alb.trim().is_empty() {
                        t.album = Some(alb.trim().to_string());
                    }
                }
                if let Some(d) = req.duration_ms {
                    if d > 0 {
                        t.duration_ms = d;
                    }
                }
                if let Some(g) = req.genre {
                    if !g.trim().is_empty() {
                        t.genre = Some(g.trim().to_string());
                    }
                }
            }
            resolved
        } else if let Some(cu) = req.context_uri {
            let mut first = self.engine.context_tracks(cu).into_iter().next();
            if let Some(ref mut t) = first {
                if let Some(n) = req.name {
                    if !n.trim().is_empty() {
                        t.name = n.trim().to_string();
                    }
                }
                if let Some(a) = req.artists {
                    if !a.is_empty() {
                        t.artists = a;
                    }
                }
                if let Some(alb) = req.album {
                    if !alb.trim().is_empty() {
                        t.album = Some(alb.trim().to_string());
                    }
                }
                if let Some(d) = req.duration_ms {
                    if d > 0 {
                        t.duration_ms = d;
                    }
                }
                if let Some(g) = req.genre {
                    if !g.trim().is_empty() {
                        t.genre = Some(g.trim().to_string());
                    }
                }
            }
            first
        } else {
            return Err(PlaybackError);
        };
        let track = match track {
            Some(t) => t,
            None => return Err(PlaybackError),
        };
        self.engine.remember_track_metadata(&track);
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            inner.state = PlaybackState::Loading;
            inner.track = Some(track.clone());
            inner.context_uri = req.context_uri.map(|s| s.to_string());
            inner.position_ms = 0;
            inner.duration_ms = track.duration_ms;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            self.snapshot_locked(&inner)
        };
        self.emit_changed(&snap).await;
        self.engine.play_track(&track.uri, true, 0);
        Ok(snap)
    }

    pub async fn play(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            if inner.duration_ms > 0 && inner.position_ms >= inner.duration_ms {
                inner.position_ms = 0;
                inner.last_emitted_position_ms = 0;
            }
            if inner.state != PlaybackState::Playing {
                inner.revision = inner.revision.wrapping_add(1);
                inner.state = PlaybackState::Playing;
                inner.last_change_at = Instant::now();
            }
            self.snapshot_locked(&inner)
        };
        self.engine.resume();
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn pause(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            if inner.state == PlaybackState::Playing || inner.state == PlaybackState::Loading {
                inner.revision = inner.revision.wrapping_add(1);
                inner.state = PlaybackState::Paused;
                inner.last_change_at = Instant::now();
            }
            self.snapshot_locked(&inner)
        };
        self.engine.pause();
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
        if snap.state == "playing" {
            self.engine.resume();
        } else {
            self.engine.pause();
        }
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn next(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let (snap, advanced_track) = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            inner.revision = inner.revision.wrapping_add(1);
            let mut advanced = None;
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
                            inner.duration_ms = resolved.duration_ms;
                            inner.track = Some(resolved.clone());
                            advanced = Some(resolved);
                        }
                    }
                }
            }
            inner.position_ms = 0;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            (self.snapshot_locked(&inner), advanced)
        };
        if let Some(ref t) = advanced_track {
            self.engine.play_track(&t.uri, snap.state == "playing", 0);
        } else {
            self.engine.next();
        }
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn previous(&self) -> Result<PlaybackChangedPayload, PlaybackError> {
        let (snap, advanced_track) = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            inner.revision = inner.revision.wrapping_add(1);
            let mut advanced = None;
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
                            inner.duration_ms = resolved.duration_ms;
                            inner.track = Some(resolved.clone());
                            advanced = Some(resolved);
                        }
                    }
                }
            }
            inner.position_ms = 0;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = 0;
            (self.snapshot_locked(&inner), advanced)
        };
        if let Some(ref t) = advanced_track {
            self.engine.play_track(&t.uri, snap.state == "playing", 0);
        } else {
            self.engine.previous();
        }
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
        self.engine.seek(position_ms as u32);
        self.emit_changed(&snap).await;
        Ok(snap)
    }

    pub async fn set_volume(&self, volume: f32) -> Result<PlaybackChangedPayload, PlaybackError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(PlaybackError);
        }
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.state == PlaybackState::Playing {
                let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
                inner.position_ms = inner.position_ms.saturating_add(elapsed).min(inner.duration_ms);
            }
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
            if inner.state == PlaybackState::Playing {
                let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
                inner.position_ms = inner.position_ms.saturating_add(elapsed).min(inner.duration_ms);
            }
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
            if inner.state == PlaybackState::Playing {
                let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
                inner.position_ms = inner.position_ms.saturating_add(elapsed).min(inner.duration_ms);
            }
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
            if inner.state == PlaybackState::Playing {
                let elapsed = inner.last_change_at.elapsed().as_millis() as u64;
                inner.position_ms = inner.position_ms.saturating_add(elapsed).min(inner.duration_ms);
            }
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
        let new_pos = inner.position_ms.saturating_add(elapsed);
        let clamped_pos = if inner.duration_ms > 0 {
            new_pos.min(inner.duration_ms)
        } else {
            new_pos
        };
        inner.position_ms = clamped_pos;
        let reached_end = inner.duration_ms > 0 && new_pos >= inner.duration_ms.saturating_add(1000);
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
            .load(LoadRequest {
                context_uri: None,
                track_uri: Some("spotify:track:test12345"),
                name: None,
                artists: None,
                album: None,
                duration_ms: None,
                genre: None,
            })
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
