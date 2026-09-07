//! Spotify Connect load context.
//!
//! The terminal drives its own queue, but the Connect receiver (and through
//! it the phone) only knows what it is told via `Spirc::load`. This module
//! turns a terminal-side play request into that load: the current track plus
//! the upcoming queue, so remote devices see the same track and can move
//! through the same queue.

/// Validated inputs for one Connect load: the track to start on, the queue
/// around it, and where playback should begin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectLoad {
    /// Queue with the current track first, order preserved.
    pub track_uris: Vec<String>,
    /// Real Spotify context (playlist/album/artist) when the play request
    /// came from one; lets Connect resolve the full context natively.
    pub context_uri: Option<String>,
    pub start_playing: bool,
    pub position_ms: u32,
}

fn valid_track_id(uri: &str) -> bool {
    match uri.strip_prefix("spotify:track:") {
        Some(id) => !id.is_empty() && id.len() <= 64,
        None => false,
    }
}

fn valid_context_uri(uri: &str) -> bool {
    const PREFIXES: [&str; 4] = [
        "spotify:playlist:",
        "spotify:album:",
        "spotify:artist:",
        "spotify:show:",
    ];
    PREFIXES.iter().any(|p| match uri.strip_prefix(p) {
        Some(id) => !id.is_empty() && id.len() <= 128,
        None => false,
    })
}

/// Build a [`ConnectLoad`] from a terminal play request.
///
/// - `track_uri` must be a valid `spotify:track:` URI.
/// - `context_uri` is kept only for playlist/album/artist/show contexts.
/// - `queue_uris` is filtered down to valid track URIs with the current
///   track moved to the head; the played track alone remains when the queue
///   contributes nothing usable.
pub fn build_connect_load(
    track_uri: &str,
    context_uri: Option<&str>,
    queue_uris: &[String],
    start_playing: bool,
    position_ms: u32,
) -> Result<ConnectLoad, String> {
    if !valid_track_id(track_uri) {
        return Err(format!("invalid track URI for Connect load: {track_uri}"));
    }
    let mut tracks: Vec<String> = queue_uris
        .iter()
        .filter(|u| valid_track_id(u))
        .cloned()
        .collect();
    match tracks.iter().position(|u| u == track_uri) {
        Some(idx) => {
            tracks.drain(..idx);
        }
        None => {
            tracks.clear();
            tracks.push(track_uri.to_string());
        }
    }
    Ok(ConnectLoad {
        track_uris: tracks,
        context_uri: context_uri
            .filter(|u| valid_context_uri(u))
            .map(String::from),
        start_playing,
        position_ms,
    })
}

impl ConnectLoad {
    fn playing_track(&self) -> String {
        self.track_uris.first().cloned().unwrap_or_default()
    }

    /// Convert into the request type `Spirc::load` accepts.
    pub fn into_spirc_request(self) -> librespot::connect::LoadRequest {
        use librespot::connect::{LoadRequest, LoadRequestOptions, PlayingTrack};
        let options = LoadRequestOptions {
            start_playing: self.start_playing,
            seek_to: self.position_ms,
            playing_track: Some(PlayingTrack::Uri(self.playing_track())),
            ..Default::default()
        };
        match self.context_uri {
            Some(ctx) => LoadRequest::from_context_uri(ctx, options),
            None => LoadRequest::from_tracks(self.track_uris, options),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| format!("spotify:track:{id}")).collect()
    }

    #[test]
    fn rejects_a_non_track_uri() {
        let err = build_connect_load("spotify:album:abc", None, &[], true, 0).unwrap_err();
        assert!(err.contains("spotify:album:abc"), "unexpected error: {err}");
    }

    #[test]
    fn single_track_without_queue_plays_alone() {
        let load = build_connect_load("spotify:track:solo", None, &[], true, 0).unwrap();
        assert_eq!(load.track_uris, vec!["spotify:track:solo".to_string()]);
        assert_eq!(load.context_uri, None);
        assert!(load.start_playing);
        assert_eq!(load.position_ms, 0);
    }

    #[test]
    fn queue_is_reordered_to_start_at_the_current_track() {
        let load =
            build_connect_load("spotify:track:t2", None, &q(&["t1", "t2", "t3"]), true, 0).unwrap();
        assert_eq!(load.track_uris, q(&["t2", "t3"]));
    }

    #[test]
    fn queue_entries_that_are_not_tracks_are_dropped() {
        let mut queue = q(&["t1", "t2"]);
        queue.push("spotify:album:abc".to_string());
        queue.push("not-a-uri".to_string());
        let load = build_connect_load("spotify:track:t1", None, &queue, true, 0).unwrap();
        assert_eq!(load.track_uris, q(&["t1", "t2"]));
    }

    #[test]
    fn foreign_track_falls_back_to_itself() {
        let load =
            build_connect_load("spotify:track:foreign", None, &q(&["t1", "t2"]), true, 0).unwrap();
        assert_eq!(load.track_uris, vec!["spotify:track:foreign".to_string()]);
    }

    #[test]
    fn playlist_context_is_kept_for_native_resolution() {
        let load = build_connect_load(
            "spotify:track:t2",
            Some("spotify:playlist:pl1"),
            &q(&["t1", "t2", "t3"]),
            true,
            5000,
        )
        .unwrap();
        assert_eq!(load.context_uri, Some("spotify:playlist:pl1".to_string()));
        assert_eq!(load.track_uris, q(&["t2", "t3"]));
        assert_eq!(load.position_ms, 5000);
    }

    #[test]
    fn non_context_uris_are_not_used_as_a_connect_context() {
        let load = build_connect_load(
            "spotify:track:t1",
            Some("spotify:track:t1"),
            &q(&["t1"]),
            false,
            0,
        )
        .unwrap();
        assert_eq!(load.context_uri, None);
        assert!(!load.start_playing);
    }
}
