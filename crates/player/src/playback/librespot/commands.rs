use tracing::{info, warn};

use super::super::engine::PlaybackEngine;
use super::super::types::{RepeatMode, Track};

impl super::LibrespotEngine {
    /// Report playback as stopped when no engine path can start it. Leaving
    /// the state in `Loading` forever would strand the UI.
    pub(super) fn emit_unavailable_stopped(&self, uri: &str) {
        self.is_stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let track_id =
            librespot::core::spotify_uri::SpotifyUri::from_uri(uri).unwrap_or_else(|_| {
                librespot::core::spotify_uri::SpotifyUri::from_uri(
                    "spotify:track:0000000000000000000000",
                )
                .expect("static fallback uri")
            });
        if let Ok(guard) = self.state_listener.lock() {
            if let Some(listener) = &*guard {
                listener.on_player_event(&librespot::playback::player::PlayerEvent::Stopped {
                    play_request_id: 0,
                    track_id,
                });
            }
        }
    }
}

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
            image_url: None,
        })
    }

    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
    }

    fn play_track(&self, uri: &str, autoplay: bool, position_ms: u32) {
        self.play_track_in_context(uri, None, &[], autoplay, position_ms);
    }

    fn prewarm(&self) {
        let self_clone = self.clone();
        tokio::spawn(async move {
            match self_clone.ensure_active().await {
                Ok(_) => tracing::debug!("librespot session prewarmed"),
                Err(e) => tracing::debug!("librespot prewarm skipped: {}", e),
            }
        });
    }

    fn play_context(&self, context_uri: &str, autoplay: bool) {
        let self_clone = self.clone();
        let context = context_uri.to_string();
        tokio::spawn(async move {
            match self_clone.ensure_active().await {
                Ok(act) => {
                    if let Some(spirc) = &act.spirc {
                        let _ = spirc.activate();
                        self_clone
                            .is_stopped
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        let options = librespot::connect::LoadRequestOptions {
                            start_playing: autoplay,
                            ..Default::default()
                        };
                        let _ = spirc.load(librespot::connect::LoadRequest::from_context_uri(
                            context.clone(),
                            options,
                        ));
                    } else {
                        warn!(
                            "Connect playback unavailable; cannot play context {}",
                            context
                        );
                        self_clone.emit_unavailable_stopped(&context);
                    }
                }
                Err(e) => {
                    warn!("Librespot playback unavailable: {}", e);
                    self_clone.emit_unavailable_stopped(&context);
                }
            }
        });
    }

    fn play_track_in_context(
        &self,
        uri: &str,
        context_uri: Option<&str>,
        queue_uris: &[String],
        autoplay: bool,
        position_ms: u32,
    ) {
        let self_clone = self.clone();
        let uri_str = uri.to_string();
        let context_str = context_uri.map(String::from);
        let queue = queue_uris.to_vec();
        tokio::spawn(async move {
            match self_clone.ensure_active().await {
                Ok(act) => {
                    if let Some(spirc) = &act.spirc {
                        // Route local playback through Connect so remote
                        // devices see the same track and queue and can control
                        // it. activate() is a no-op when already active, and
                        // both commands run in send order.
                        let _ = spirc.activate();
                        self_clone.is_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                        match super::connect_load::build_connect_load(
                            &uri_str,
                            context_str.as_deref(),
                            &queue,
                            autoplay,
                            position_ms,
                        ) {
                            Ok(load) => {
                                let _ = spirc.load(load.into_spirc_request());
                            }
                            Err(e) => {
                                warn!(
                                    "Connect load rejected ({}); falling back to direct playback",
                                    e
                                );
                                if let Ok(sp_uri) =
                                    librespot::core::spotify_uri::SpotifyUri::from_uri(&uri_str)
                                {
                                    self_clone.is_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                                    act.player.load(sp_uri, autoplay, position_ms);
                                }
                            }
                        }
                    } else if let Ok(sp_uri) =
                        librespot::core::spotify_uri::SpotifyUri::from_uri(&uri_str)
                    {
                        self_clone.is_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                        info!("Spotoei playing track: {}", uri_str);
                        act.player.load(sp_uri, autoplay, position_ms);
                    }
                }
                Err(e) => {
                    warn!("Librespot playback unavailable: {}", e);
                    self_clone.emit_unavailable_stopped(&uri_str);
                }
            }
        });
    }

    fn resume(&self) {
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

    fn pause(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let guard = inner.lock().await;
            if let Some(act) = &*guard {
                act.player.pause();
            }
        });
    }

    fn stop(&self) {
        self.is_stopped.store(true, std::sync::atomic::Ordering::SeqCst);
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

    fn release(&self) {
        self.is_stopped.store(true, std::sync::atomic::Ordering::SeqCst);
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
    fn seek(&self, position_ms: u32) {
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

    fn set_volume(&self, volume: f32) {
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

    fn next(&self) {
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
    fn previous(&self) {
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
    fn set_shuffle(&self, shuffle: bool) {
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
    fn set_repeat(&self, mode: RepeatMode) {
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

    fn device_mode(&self) -> super::super::types::DeviceMode {
        if let Ok(guard) = self.config.try_lock() {
            guard.device_mode
        } else {
            super::super::types::DeviceMode::Integrated
        }
    }

    fn set_device_mode(&self, mode: super::super::types::DeviceMode) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.device_mode = mode;
        }
    }

    fn audio_backend(&self) -> super::super::types::AudioBackend {
        if let Ok(guard) = self.config.try_lock() {
            guard.audio_backend
        } else {
            super::super::types::AudioBackend::Rodio
        }
    }

    fn set_audio_backend(&self, backend: super::super::types::AudioBackend) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.audio_backend = backend;
        }
    }

    fn bitrate(&self) -> super::super::types::Bitrate {
        if let Ok(guard) = self.config.try_lock() {
            guard.bitrate
        } else {
            super::super::types::Bitrate::Bitrate320
        }
    }

    fn set_bitrate(&self, bitrate: super::super::types::Bitrate) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.bitrate = bitrate;
        }
    }

    fn crossfade_duration_ms(&self) -> u32 {
        if let Ok(guard) = self.config.try_lock() {
            guard.crossfade_duration_ms
        } else {
            0
        }
    }

    fn set_crossfade_duration_ms(&self, duration_ms: u32) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.crossfade_duration_ms = duration_ms.clamp(0, 15_000);
        }
    }

    fn normalisation(&self) -> bool {
        if let Ok(guard) = self.config.try_lock() {
            guard.normalisation
        } else {
            true
        }
    }

    fn set_normalisation(&self, enabled: bool) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.normalisation = enabled;
        }
    }

    fn normalisation_type(&self) -> String {
        if let Ok(guard) = self.config.try_lock() {
            guard.normalisation_type.clone()
        } else {
            "album".to_string()
        }
    }

    fn set_normalisation_type(&self, norm_type: &str) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.normalisation_type = match norm_type.trim().to_ascii_lowercase().as_str() {
                "track" => "track".to_string(),
                _ => "album".to_string(),
            };
        }
    }

    fn pregain(&self) -> f32 {
        if let Ok(guard) = self.config.try_lock() {
            guard.pregain
        } else {
            0.0
        }
    }

    fn set_pregain(&self, pregain: f32) {
        if let Ok(mut guard) = self.config.try_lock() {
            guard.pregain = if pregain.is_nan() {
                0.0
            } else {
                pregain.clamp(-20.0, 20.0)
            };
        }
    }

    fn attach_state_listener(&self, listener: std::sync::Arc<dyn super::super::engine::PlaybackStateListener>) {
        if let Ok(mut guard) = self.state_listener.lock() {
            *guard = Some(listener);
        }
    }

    fn reconcile_player_event(&self, event: &librespot::playback::player::PlayerEvent) {
        use librespot::playback::player::PlayerEvent;
        match event {
            PlayerEvent::Playing { .. } | PlayerEvent::Paused { .. } | PlayerEvent::Loading { .. } => {
                self.is_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                if matches!(event, PlayerEvent::Playing { .. }) {
                    if let Ok(mut tracker) = self.unavailable.lock() {
                        tracker.note_playing();
                    }
                }
            }
            PlayerEvent::Stopped { .. } => {
                self.is_stopped.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            PlayerEvent::Unavailable { .. } => {
                let reconnect = self
                    .unavailable
                    .lock()
                    .map(|mut tracker| tracker.note_unavailable(super::reauth::now_ms()))
                    .unwrap_or(false);
                if reconnect {
                    tracing::warn!(
                        "tracks repeatedly unloadable; reconnecting with a fresh token"
                    );
                    let engine = self.clone();
                    tokio::spawn(async move {
                        engine.reconnect_with_fresh_token().await;
                    });
                }
            }
            _ => {}
        }
        if let librespot::playback::player::PlayerEvent::TrackChanged { audio_item } = event {
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
            let track = super::super::types::Track {
                uri,
                name: audio_item.name.clone(),
                artists,
                album,
                duration_ms: audio_item.duration_ms as u64,
                genre: None,
                image_url: audio_item.covers.first().map(|c| c.url.clone()),
            };
            self.remember_track_metadata(&track);
        }
        if let Ok(guard) = self.state_listener.lock() {
            if let Some(listener) = &*guard {
                listener.on_player_event(event);
            }
        }
    }
}
