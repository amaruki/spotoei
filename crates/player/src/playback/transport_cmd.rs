use std::time::Instant;

use super::state::Playback;
use super::types::{LoadRequest, PlaybackChangedPayload, PlaybackError, PlaybackState, Track};

impl Playback {
    pub async fn load(
        &self,
        req: LoadRequest<'_>,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        self.load_opts(req, false).await
    }

    pub async fn load_opts(
        &self,
        req: LoadRequest<'_>,
        autoplay: bool,
    ) -> Result<PlaybackChangedPayload, PlaybackError> {
        let track: Option<Track> = if let Some(tu) = req.track_uri {
            let mut resolved = self.engine.resolve_track(tu);
            if let Some(ref mut t) = resolved {
                apply_track_overrides(t, &req);
            }
            resolved
        } else if let Some(cu) = req.context_uri {
            // Context-only load: real metadata arrives with librespot's
            // TrackChanged event; the placeholder carries what the TUI knows.
            let mut placeholder = Track {
                uri: cu.to_string(),
                name: "Loading…".to_string(),
                ..Track::default()
            };
            apply_track_overrides(&mut placeholder, &req);
            Some(placeholder)
        } else {
            return Err(PlaybackError);
        };
        let track = match track {
            Some(t) => t,
            None => return Err(PlaybackError),
        };
        self.engine.remember_track_metadata(&track);
        let queue_uris: Vec<String> = req.queue_uris.unwrap_or_else(|| vec![track.uri.clone()]);
        let snap = {
            let mut inner = self.inner.lock().await;
            inner.revision = inner.revision.wrapping_add(1);
            // Audio starts asynchronously; Playing only comes from
            // PlayerEvent::Playing, never from load time.
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
        if let Some(tu) = req.track_uri {
            self.engine
                .play_track_in_context(tu, req.context_uri, &queue_uris, autoplay, 0);
        } else if let Some(cu) = req.context_uri {
            self.engine.play_context(cu, autoplay);
        }
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

    pub async fn seek_relative(&self, offset_ms: i64) -> Result<PlaybackChangedPayload, PlaybackError> {
        let snap = {
            let mut inner = self.inner.lock().await;
            if inner.track.is_none() {
                return Err(PlaybackError);
            }
            super::settings_cmd::advance_position_if_playing(&mut inner);
            let target = if offset_ms >= 0 {
                inner.position_ms.saturating_add(offset_ms as u64)
            } else {
                inner.position_ms.saturating_sub(offset_ms.unsigned_abs())
            };
            let clamped = target.min(inner.duration_ms);
            inner.revision = inner.revision.wrapping_add(1);
            inner.position_ms = clamped;
            inner.last_change_at = Instant::now();
            inner.last_emitted_position_ms = clamped;
            self.snapshot_locked(&inner)
        };
        let target_pos = {
            let inner = self.inner.lock().await;
            inner.position_ms
        };
        self.engine.seek(target_pos as u32);
        self.emit_changed(&snap).await;
        Ok(snap)
    }
}

fn apply_track_overrides(track: &mut Track, req: &LoadRequest<'_>) {
    if let Some(n) = req.name {
        let trimmed = n.trim();
        if !trimmed.is_empty() {
            track.name = trimmed.to_string();
        }
    }
    if let Some(a) = req.artists.clone() {
        if !a.is_empty() {
            track.artists = a;
        }
    }
    if let Some(alb) = req.album {
        let trimmed = alb.trim();
        if !trimmed.is_empty() {
            track.album = Some(trimmed.to_string());
        }
    }
    if let Some(d) = req.duration_ms {
        if d > 0 {
            track.duration_ms = d;
        }
    }
    if let Some(g) = req.genre {
        let trimmed = g.trim();
        if !trimmed.is_empty() {
            track.genre = Some(trimmed.to_string());
        }
    }
}
