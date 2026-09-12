//! MPRIS D-Bus service.
//!
//! A TUI cannot receive global media keys directly; desktop environments and
//! `WirePlumber` route Bluetooth headset buttons (AVRCP) and media keys to the
//! active MPRIS player. This exposes playback as
//! `org.mpris.MediaPlayer2.spotoei` and maps MPRIS commands onto `Playback`.
//!
//! `mpris-server`'s `Player` is intentionally `!Send`, so it runs on its own
//! thread with a current-thread tokio runtime and a `LocalSet`.

use std::time::Duration;

use mpris_server::{LoopStatus, Metadata, PlaybackStatus, Player, Time, TrackId};
use tracing::{info, warn};

use crate::playback::{Playback, Track};

const POSITION_POLL_MS: u64 = 250;

/// Start the MPRIS service on a dedicated thread. No-op when the session bus
/// is unavailable (headless sessions), so playback keeps working without it.
pub fn spawn(playback: Playback) {
    let spawned = std::thread::Builder::new()
        .name("spotoei-mpris".to_string())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(e) => {
                    warn!("MPRIS runtime unavailable: {e}");
                    return;
                }
            };
            let local = tokio::task::LocalSet::new();
            local.block_on(&runtime, run(playback));
        });
    if let Err(e) = spawned {
        warn!("failed to spawn MPRIS thread: {e}");
    }
}

async fn run(playback: Playback) {
    let player = match Player::builder("spotoei")
        .identity("Spotoei")
        .desktop_entry("spotoei")
        .can_play(true)
        .can_pause(true)
        .can_go_next(true)
        .can_go_previous(true)
        .can_seek(true)
        .can_control(true)
        .build()
        .await
    {
        Ok(player) => player,
        Err(e) => {
            warn!("MPRIS unavailable (no session bus?): {e}");
            return;
        }
    };

    connect_controls(&player, &playback);
    tokio::task::spawn_local(player.run());
    info!("MPRIS service registered as org.mpris.MediaPlayer2.spotoei");

    publish_loop(playback, player).await;
}

/// Mirror MPRIS method calls onto the playback state machine. Callbacks run
/// on the MPRIS thread; the spawned futures capture `Playback` (Send).
fn connect_controls(player: &Player, playback: &Playback) {
    macro_rules! control {
        ($connect:ident, $method:ident) => {{
            let pb = playback.clone();
            player.$connect(move |_player| {
                let pb = pb.clone();
                tokio::spawn(async move {
                    let _ = pb.$method().await;
                });
            });
        }};
    }

    control!(connect_play, play);
    control!(connect_pause, pause);
    control!(connect_play_pause, toggle);
    control!(connect_next, next);
    control!(connect_previous, previous);
    control!(connect_stop, pause);

    let pb = playback.clone();
    player.connect_seek(move |_player, offset| {
        let pb = pb.clone();
        tokio::spawn(async move {
            let _ = pb.seek_relative(offset.as_millis()).await;
        });
    });

    let pb = playback.clone();
    player.connect_set_position(move |_player, _track_id, position| {
        let pb = pb.clone();
        tokio::spawn(async move {
            let _ = pb.seek(position.as_millis().max(0) as u64).await;
        });
    });

    let pb = playback.clone();
    player.connect_set_shuffle(move |_player, shuffle| {
        let pb = pb.clone();
        tokio::spawn(async move {
            let _ = pb.set_shuffle(shuffle).await;
        });
    });

    let pb = playback.clone();
    player.connect_set_loop_status(move |_player, loop_status| {
        let pb = pb.clone();
        tokio::spawn(async move {
            let repeat = match loop_status {
                LoopStatus::Track => "track",
                LoopStatus::Playlist => "context",
                LoopStatus::None => "off",
            };
            let _ = pb.set_repeat(repeat).await;
        });
    });

    let pb = playback.clone();
    player.connect_set_volume(move |_player, volume| {
        let pb = pb.clone();
        tokio::spawn(async move {
            let _ = pb.set_volume(volume as f32).await;
        });
    });
}

/// Publish playback state to MPRIS. Polling keeps the service decoupled from
/// the protocol event channel; snapshots are in-memory reads.
async fn publish_loop(playback: Playback, player: Player) {
    let mut interval = tokio::time::interval(Duration::from_millis(POSITION_POLL_MS));
    let mut last_revision = u64::MAX;
    let mut last_track: Option<String> = None;

    loop {
        interval.tick().await;
        let snap = playback.snapshot().await;

        if snap.revision != last_revision {
            last_revision = snap.revision;
            let _ = player
                .set_playback_status(playback_status(&snap.state))
                .await;
            let _ = player.set_shuffle(snap.shuffle).await;
            let _ = player.set_loop_status(loop_status(&snap.repeat)).await;
            let _ = player.set_volume(snap.volume as f64).await;
        }

        if let Some(track) = snap.track.as_ref() {
            if last_track.as_deref() != Some(track.uri.as_str()) {
                last_track = Some(track.uri.clone());
                let _ = player.set_metadata(metadata_for(track)).await;
            }
        }

        let position_ms = i64::try_from(snap.position_ms).unwrap_or(i64::MAX);
        player.set_position(Time::from_millis(position_ms));
    }
}

fn playback_status(state: &str) -> PlaybackStatus {
    match state {
        "playing" | "loading" | "buffering" | "reconnecting" => PlaybackStatus::Playing,
        "paused" => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    }
}

fn loop_status(repeat: &str) -> LoopStatus {
    match repeat {
        "track" => LoopStatus::Track,
        "context" => LoopStatus::Playlist,
        _ => LoopStatus::None,
    }
}

fn metadata_for(track: &Track) -> Metadata {
    let track_id = TrackId::try_from(track_path(&track.uri)).unwrap_or(TrackId::NO_TRACK);
    let mut builder = Metadata::builder()
        .trackid(track_id)
        .title(track.name.clone())
        .artist(track.artists.clone());
    if let Some(album) = &track.album {
        builder = builder.album(album.clone());
    }
    if track.duration_ms > 0 {
        builder = builder.length(Time::from_millis(
            i64::try_from(track.duration_ms).unwrap_or(i64::MAX),
        ));
    }
    if let Some(url) = &track.image_url {
        builder = builder.art_url(url.clone());
    }
    builder.build()
}

/// MPRIS track ids must be D-Bus object paths; Spotify URIs are not.
fn track_path(uri: &str) -> String {
    let sanitized: String = uri
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "/org/spotoei/track/unknown".to_string()
    } else {
        format!("/org/spotoei/track/{sanitized}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_track() -> Track {
        Track {
            uri: "spotify:track:abc123".to_string(),
            name: "Song".to_string(),
            artists: vec!["Artist".to_string()],
            album: Some("Album".to_string()),
            duration_ms: 180_000,
            genre: None,
            image_url: Some("https://i.scdn.co/image/cover".to_string()),
        }
    }

    #[test]
    fn maps_playback_states_to_mpris_status() {
        assert_eq!(playback_status("playing"), PlaybackStatus::Playing);
        assert_eq!(playback_status("loading"), PlaybackStatus::Playing);
        assert_eq!(playback_status("paused"), PlaybackStatus::Paused);
        assert_eq!(playback_status("idle"), PlaybackStatus::Stopped);
        assert_eq!(playback_status("error"), PlaybackStatus::Stopped);
    }

    #[test]
    fn maps_repeat_modes_to_loop_status() {
        assert_eq!(loop_status("off"), LoopStatus::None);
        assert_eq!(loop_status("context"), LoopStatus::Playlist);
        assert_eq!(loop_status("track"), LoopStatus::Track);
    }

    #[test]
    fn sanitizes_track_uri_into_object_path() {
        assert_eq!(
            track_path("spotify:track:abc123"),
            "/org/spotoei/track/spotify_track_abc123"
        );
        assert_eq!(track_path(""), "/org/spotoei/track/unknown");
        assert_eq!(track_path(":::"), "/org/spotoei/track/unknown");
    }

    #[test]
    fn builds_metadata_from_track() {
        let metadata = metadata_for(&sample_track());
        assert_eq!(metadata.title(), Some("Song"));
        assert_eq!(metadata.album(), Some("Album"));
        assert_eq!(metadata.length(), Some(Time::from_millis(180_000)));
        assert_eq!(
            metadata.art_url().as_deref(),
            Some("https://i.scdn.co/image/cover")
        );
        assert!(metadata.trackid().is_some());
    }
}
