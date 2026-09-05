use serde::Deserialize;
use tracing::info;

#[derive(Debug, Deserialize)]
struct TrackData {
    original_gid: String,
}

#[derive(Debug, Deserialize)]
struct RadioStationResponse {
    tracks: Vec<TrackData>,
}

impl super::super::LibrespotEngine {
    /// Retrieve list of autoplay/radio track URIs from a seed URI using Spotify Mercury radio-apollo protocol.
    pub async fn get_radio_tracks(&self, seed_uri: &str) -> Result<Vec<String>, String> {
        let act = self.ensure_active().await?;
        let session = &act._session;

        let autoplay_query_url = format!("hm://autoplay-enabled/query?uri={seed_uri}");
        info!("Fetching Mercury autoplay URI for seed: {}", seed_uri);

        let response = session
            .mercury()
            .get(autoplay_query_url)
            .map_err(|e| format!("Failed to initiate Mercury autoplay query: {:?}", e))?
            .await
            .map_err(|e| format!("Mercury autoplay query failed: {:?}", e))?;

        if response.status_code != 200 || response.payload.is_empty() {
            return Err(format!(
                "Non-OK or empty response for autoplay query (status: {})",
                response.status_code
            ));
        }

        let autoplay_uri = String::from_utf8(response.payload[0].clone())
            .map_err(|e| format!("Invalid UTF-8 in autoplay URI response: {:?}", e))?;

        info!("Resolved Mercury radio station URI: {}", autoplay_uri);

        let radio_query_url = format!("hm://radio-apollo/v3/stations/{autoplay_uri}");
        let radio_response = session
            .mercury()
            .get(radio_query_url)
            .map_err(|e| format!("Failed to initiate Mercury radio query: {:?}", e))?
            .await
            .map_err(|e| format!("Mercury radio query failed: {:?}", e))?;

        if radio_response.status_code != 200 || radio_response.payload.is_empty() {
            return Err(format!(
                "Non-OK or empty response for radio query (status: {})",
                radio_response.status_code
            ));
        }

        let radio_data = serde_json::from_slice::<RadioStationResponse>(&radio_response.payload[0])
            .map_err(|e| format!("Failed to parse radio station JSON: {:?}", e))?;

        let mut uris = Vec::new();
        for t in radio_data.tracks {
            // Convert gid hex/id to Spotify track URI
            // In Mercury radio response, original_gid is 32-hex or base62 Spotify ID
            let gid = t.original_gid;
            if gid.len() == 22 {
                uris.push(format!("spotify:track:{gid}"));
            } else if gid.len() == 32 {
                if let Ok(bytes) = hex_to_16_bytes(&gid) {
                    if let Ok(sp_id) = librespot::core::spotify_id::SpotifyId::from_raw(&bytes) {
                        if let Ok(base62) = sp_id.to_base62() {
                            uris.push(format!("spotify:track:{base62}"));
                        }
                    }
                }
            }
        }

        info!("Retrieved {} radio tracks for autoplay", uris.len());
        Ok(uris)
    }
}

fn hex_to_16_bytes(s: &str) -> Result<[u8; 16], ()> {
    if s.len() != 32 {
        return Err(());
    }
    let mut bytes = [0u8; 16];
    for i in 0..16 {
        bytes[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|_| ())?;
    }
    Ok(bytes)
}
