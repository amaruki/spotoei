use std::sync::Arc;

/// Background task monitoring `PlayerEvent`s and reconciling state into `PlaybackEngine`.
pub fn monitor_player_events(
    mut event_channel: librespot::playback::player::PlayerEventChannel,
    state_engine: Arc<crate::playback::librespot::LibrespotEngine>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        use crate::playback::PlaybackEngine;
        use librespot::playback::player::PlayerEvent;
        while let Some(event) = event_channel.recv().await {
            if let PlayerEvent::Playing {
                track_id,
                position_ms,
                ..
            } = &event
            {
                let load_ms = state_engine
                    .load_started_at
                    .lock()
                    .ok()
                    .and_then(|mut started| started.take())
                    .map(|t0| t0.elapsed().as_millis() as u64);
                if let Some(load_ms) = load_ms {
                    tracing::info!(track = %track_id, load_ms, position_ms, "Playback started");
                }
            }
            match &event {
                PlayerEvent::Playing {
                    track_id,
                    position_ms,
                    ..
                } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Playing");
                }
                PlayerEvent::Paused {
                    track_id,
                    position_ms,
                    ..
                } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Paused");
                }
                PlayerEvent::Loading {
                    track_id,
                    position_ms,
                    ..
                } => {
                    tracing::debug!(track = %track_id, pos = position_ms, "PlayerEvent::Loading");
                }
                PlayerEvent::Stopped { track_id, .. } => {
                    tracing::debug!(track = %track_id, "PlayerEvent::Stopped");
                }
                PlayerEvent::PositionCorrection { position_ms, .. } => {
                    tracing::debug!(pos = position_ms, "PlayerEvent::PositionCorrection");
                }
                PlayerEvent::VolumeChanged { volume } => {
                    tracing::debug!(vol = volume, "PlayerEvent::VolumeChanged");
                }
                PlayerEvent::TrackChanged { audio_item } => {
                    tracing::debug!(name = %audio_item.name, "PlayerEvent::TrackChanged");
                }
                _ => {}
            }
            state_engine.reconcile_player_event(&event);
        }
    })
}
