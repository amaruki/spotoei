use crate::lyrics::LyricsDocument;
use crate::playback::types::Track;

use super::LibrespotEngine;

// Metadata and lyrics fetches extracted from `mod.rs` for the 300 LoC cap.
impl LibrespotEngine {
    /// Fetch track metadata using `librespot::metadata::Track::get` with active session
    pub async fn fetch_metadata(
        &self,
        id: &librespot::core::spotify_uri::SpotifyUri,
    ) -> Result<Track, String> {
        let act = self.ensure_active().await?;
        let session = &act.session;
        use librespot::metadata::Metadata;
        let track = librespot::metadata::Track::get(session, id)
            .await
            .map_err(|e| format!("Failed to fetch track metadata: {:?}", e))?;
        let uri = track
            .id
            .to_uri()
            .unwrap_or_else(|_| format!("spotify:track:{}", track.id));
        let artists = track.artists.iter().map(|a| a.name.clone()).collect();
        let album = Some(track.album.name.clone());
        let t = Track {
            uri,
            name: track.name.clone(),
            artists,
            album,
            duration_ms: track.duration.max(0) as u64,
            genre: None,
            image_url: track
                .album
                .covers
                .first()
                .map(|img| format!("https://i.scdn.co/image/{}", img.id)),
        };
        if let Ok(mut cache) = self.track_metadata_cache.try_lock() {
            cache.insert(t.uri.clone(), t.clone());
        }
        Ok(t)
    }

    pub async fn fetch_track_metadata(&self, track_uri_or_id: &str) -> Result<Track, String> {
        let uri = if track_uri_or_id.starts_with("spotify:track:") {
            librespot::core::spotify_uri::SpotifyUri::from_uri(track_uri_or_id)
                .map_err(|e| format!("Invalid track URI: {:?}", e))?
        } else if track_uri_or_id.len() == 22 {
            let full_uri = format!("spotify:track:{}", track_uri_or_id);
            librespot::core::spotify_uri::SpotifyUri::from_uri(&full_uri)
                .map_err(|e| format!("Invalid track ID: {:?}", e))?
        } else {
            librespot::core::spotify_uri::SpotifyUri::from_uri(track_uri_or_id)
                .map_err(|e| format!("Invalid track specifier: {:?}", e))?
        };
        self.fetch_metadata(&uri).await
    }

    pub async fn fetch_lyrics(&self, track_uri_or_id: &str) -> Result<LyricsDocument, String> {
        let act = self.ensure_active().await?;
        crate::lyrics::fetch_session_lyrics(&act.session, track_uri_or_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn fetch_mercury_lyrics(
        &self,
        track_uri_or_id: &str,
    ) -> Result<LyricsDocument, String> {
        let act = self.ensure_active().await?;
        crate::lyrics::fetch_mercury_lyrics(&act.session, track_uri_or_id)
            .await
            .map_err(|e| e.to_string())
    }
}
