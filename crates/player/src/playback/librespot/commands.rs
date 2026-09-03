use tracing::{info, warn};

use super::super::engine::PlaybackEngine;
use super::super::types::{RepeatMode, Track};

impl PlaybackEngine for super::LibrespotEngine {
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
                    let req = librespot::connect::LoadRequest::from_tracks(
                        vec![uri_str.clone()],
                        options,
                    );
                    if let Err(e) = act.spirc.load(req) {
                        warn!("Spirc load failed, fallback to direct player: {:?}", e);
                        if let Ok(sp_uri) =
                            librespot::core::spotify_uri::SpotifyUri::from_uri(&uri_str)
                        {
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
