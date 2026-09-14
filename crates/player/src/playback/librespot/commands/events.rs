use crate::playback::engine::{PlaybackEngine, PlaybackStateListener};
use crate::playback::librespot::LibrespotEngine;
use crate::playback::types::Track;

// Player-event reconciliation extracted from `commands.rs` for the 300 LoC
// cap.
impl LibrespotEngine {
    pub(super) fn attach_state_listener_impl(
        &self,
        listener: std::sync::Arc<dyn PlaybackStateListener>,
    ) {
        if let Ok(mut guard) = self.state_listener.lock() {
            *guard = Some(listener);
        }
    }

    pub(super) fn reconcile_player_event_impl(
        &self,
        event: &librespot::playback::player::PlayerEvent,
    ) {
        use librespot::playback::player::PlayerEvent;
        match event {
            PlayerEvent::Playing { .. }
            | PlayerEvent::Paused { .. }
            | PlayerEvent::Loading { .. } => {
                self.is_stopped
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                if matches!(event, PlayerEvent::Playing { .. }) {
                    if let Ok(mut tracker) = self.unavailable.lock() {
                        tracker.note_playing();
                    }
                }
            }
            PlayerEvent::Stopped { .. } => {
                self.is_stopped
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            PlayerEvent::Unavailable { .. } => {
                let reconnect = self
                    .unavailable
                    .lock()
                    .map(|mut tracker| {
                        tracker.note_unavailable(crate::playback::librespot::reauth::now_ms())
                    })
                    .unwrap_or(false);
                if reconnect {
                    tracing::warn!("tracks repeatedly unloadable; reconnecting with a fresh token");
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
                librespot::metadata::audio::item::UniqueFields::Track {
                    artists, album, ..
                } => (
                    artists.iter().map(|a| a.name.clone()).collect(),
                    Some(album.clone()),
                ),
                _ => (vec!["Unknown Artist".to_string()], None),
            };
            let track = Track {
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
