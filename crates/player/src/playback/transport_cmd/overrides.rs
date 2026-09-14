use super::super::types::{LoadRequest, Track};

pub(super) fn apply_track_overrides(track: &mut Track, req: &LoadRequest<'_>) {
    if let Some(n) = req.name {
        let trimmed = n.trim();
        if !trimmed.is_empty() {
            track.name = trimmed.to_string();
        }
    }
    if let Some(a) = req.artists.clone() {
        if !a.is_empty() {
            track.artists = a;
        }
    }
    if let Some(alb) = req.album {
        let trimmed = alb.trim();
        if !trimmed.is_empty() {
            track.album = Some(trimmed.to_string());
        }
    }
    if let Some(d) = req.duration_ms {
        if d > 0 {
            track.duration_ms = d;
        }
    }
    if let Some(g) = req.genre {
        let trimmed = g.trim();
        if !trimmed.is_empty() {
            track.genre = Some(trimmed.to_string());
        }
    }
}
