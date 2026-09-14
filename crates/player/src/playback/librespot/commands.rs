mod events;
mod playback;
mod settings;
mod transport;

use std::sync::Arc;

use crate::playback::engine::{PlaybackEngine, PlaybackStateListener};
use crate::playback::librespot::LibrespotEngine;
use crate::playback::types::{RepeatMode, Track};

// `PlaybackEngine` implementation for the librespot-backed engine. The trait
// surface is split across sibling modules (`playback`, `transport`,
// `settings`, `events`) to stay under the 300 LoC ceiling; those modules
// expose inherent `*_impl` methods and this module forwards the trait calls.
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
            image_url: None,
        })
    }

    fn context_tracks(&self, _context_uri: &str) -> Vec<Track> {
        Vec::new()
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

    fn play_track(&self, uri: &str, autoplay: bool, position_ms: u32) {
        self.play_track_impl(uri, autoplay, position_ms);
    }

    fn play_context(&self, context_uri: &str, autoplay: bool) {
        self.play_context_impl(context_uri, autoplay);
    }

    fn play_track_in_context(
        &self,
        uri: &str,
        context_uri: Option<&str>,
        queue_uris: &[String],
        autoplay: bool,
        position_ms: u32,
    ) {
        self.play_track_in_context_impl(uri, context_uri, queue_uris, autoplay, position_ms);
    }

    fn resume(&self) {
        self.resume_impl();
    }

    fn pause(&self) {
        self.pause_impl();
    }

    fn stop(&self) {
        self.stop_impl();
    }

    fn release(&self) {
        self.release_impl();
    }

    fn seek(&self, position_ms: u32) {
        self.seek_impl(position_ms);
    }

    fn set_volume(&self, volume: f32) {
        self.set_volume_impl(volume);
    }

    fn next(&self) {
        self.next_impl();
    }

    fn previous(&self) {
        self.previous_impl();
    }

    fn set_shuffle(&self, shuffle: bool) {
        self.set_shuffle_impl(shuffle);
    }

    fn set_repeat(&self, mode: RepeatMode) {
        self.set_repeat_impl(mode);
    }

    fn device_mode(&self) -> crate::playback::types::DeviceMode {
        self.device_mode_impl()
    }

    fn set_device_mode(&self, mode: crate::playback::types::DeviceMode) {
        self.set_device_mode_impl(mode);
    }

    fn audio_backend(&self) -> crate::playback::types::AudioBackend {
        self.audio_backend_impl()
    }

    fn set_audio_backend(&self, backend: crate::playback::types::AudioBackend) {
        self.set_audio_backend_impl(backend);
    }

    fn bitrate(&self) -> crate::playback::types::Bitrate {
        self.bitrate_impl()
    }

    fn set_bitrate(&self, bitrate: crate::playback::types::Bitrate) {
        self.set_bitrate_impl(bitrate);
    }

    fn crossfade_duration_ms(&self) -> u32 {
        self.crossfade_duration_ms_impl()
    }

    fn set_crossfade_duration_ms(&self, duration_ms: u32) {
        self.set_crossfade_duration_ms_impl(duration_ms);
    }

    fn normalisation(&self) -> bool {
        self.normalisation_impl()
    }

    fn set_normalisation(&self, enabled: bool) {
        self.set_normalisation_impl(enabled);
    }

    fn normalisation_type(&self) -> String {
        self.normalisation_type_impl()
    }

    fn set_normalisation_type(&self, norm_type: &str) {
        self.set_normalisation_type_impl(norm_type);
    }

    fn pregain(&self) -> f32 {
        self.pregain_impl()
    }

    fn set_pregain(&self, pregain: f32) {
        self.set_pregain_impl(pregain);
    }

    fn attach_state_listener(&self, listener: Arc<dyn PlaybackStateListener>) {
        self.attach_state_listener_impl(listener);
    }

    fn reconcile_player_event(&self, event: &librespot::playback::player::PlayerEvent) {
        self.reconcile_player_event_impl(event);
    }
}
