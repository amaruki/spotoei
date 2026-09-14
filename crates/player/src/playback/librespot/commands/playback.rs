use tracing::{info, warn};

use crate::playback::librespot::LibrespotEngine;

// Load/context playback entry points extracted from `commands.rs` for the
// 300 LoC cap.
impl LibrespotEngine {
    /// Timestamp the most recent load request so the first `Playing` event
    /// can report end-to-end load latency.
    fn note_load_requested(&self) {
        if let Ok(mut started) = self.load_started_at.lock() {
            *started = Some(std::time::Instant::now());
        }
    }

    /// Report playback as stopped when no engine path can start it. Leaving
    /// the state in `Loading` forever would strand the UI.
    fn emit_unavailable_stopped(&self, uri: &str) {
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

impl LibrespotEngine {
    pub(super) fn play_track_impl(&self, uri: &str, autoplay: bool, position_ms: u32) {
        self.play_track_in_context_impl(uri, None, &[], autoplay, position_ms);
    }

    pub(super) fn play_context_impl(&self, context_uri: &str, autoplay: bool) {
        let self_clone = self.clone();
        let context = context_uri.to_string();
        self.note_load_requested();
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

    pub(super) fn play_track_in_context_impl(
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
        self.note_load_requested();
        tokio::spawn(async move {
            match self_clone.ensure_active().await {
                Ok(act) => {
                    if let Some(spirc) = &act.spirc {
                        // Route local playback through Connect so remote
                        // devices see the same track and queue and can control
                        // it. activate() is a no-op when already active, and
                        // both commands run in send order.
                        let _ = spirc.activate();
                        self_clone
                            .is_stopped
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        match crate::playback::librespot::connect_load::build_connect_load(
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
                                    self_clone
                                        .is_stopped
                                        .store(false, std::sync::atomic::Ordering::SeqCst);
                                    act.player.load(sp_uri, autoplay, position_ms);
                                }
                            }
                        }
                    } else if let Ok(sp_uri) =
                        librespot::core::spotify_uri::SpotifyUri::from_uri(&uri_str)
                    {
                        self_clone
                            .is_stopped
                            .store(false, std::sync::atomic::Ordering::SeqCst);
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
}
