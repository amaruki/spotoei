import type { CatalogTrackT, PlaybackChangedDataT, TrackT } from 'spotoei-protocol';

import type { AppContext } from './types';
import { capitalCase, formatArtistsList } from './utils';

export function createEnrichment(ctx: AppContext) {
  const { clients, state, getUi } = ctx;
  // Failed genre lookups (usually rate limiting) are remembered briefly so
  // every playback event does not refetch the same artist. Successes live in
  // the shared artistGenreCache; failures live here with an expiry.
  const genreFailureUntil = new Map<string, number>();
  const GENRE_FAILURE_TTL_MS = 5 * 60 * 1000;

  const resolveTrackGenre = async (
    artistId?: string,
    artists?: Array<string | { id?: string; name: string }>,
  ): Promise<string | undefined> => {
    let id = artistId;
    if (!id && artists && artists.length > 0) {
      const first = artists[0];
      if (typeof first === 'object' && 'id' in first && first.id) {
        id = first.id;
      }
    }
    if (!id || id === 'unknown') return undefined;
    if (state.artistGenreCache.has(id)) {
      return state.artistGenreCache.get(id);
    }
    const failedUntil = genreFailureUntil.get(id);
    if (failedUntil !== undefined) {
      if (Date.now() < failedUntil) return undefined;
      genreFailureUntil.delete(id);
    }
    try {
      const genres = await clients.webApi.getArtistGenres(id);
      if (genres && genres.length > 0) {
        const formatted = genres
          .slice(0, 2)
          .map((g) => capitalCase(g))
          .join(' / ');
        state.artistGenreCache.set(id, formatted);
        return formatted;
      }
    } catch {
      genreFailureUntil.set(id, Date.now() + GENRE_FAILURE_TTL_MS);
    }
    return undefined;
  };

  const enrichPlaybackTrack = (next: PlaybackChangedDataT): PlaybackChangedDataT => {
    if (!next.track) return next;
    const uri = next.track.uri;
    const matched =
      state.activePlaylistTracks.find((t) => t.uri === uri) ??
      state.libraryItems.find((t) => t.uri === uri);

    let view: PlaybackChangedDataT = next;

    if (matched && 'durationMs' in matched) {
      const matchedTrack = matched as CatalogTrackT;
      const track: TrackT = { ...next.track };
      if (!track.name || track.name.startsWith('Track ')) {
        track.name = matchedTrack.name;
      }
      if (
        !track.artists ||
        track.artists.length === 0 ||
        track.artists[0] === 'Spotify Artist' ||
        track.artists[0] === 'Unknown Artist'
      ) {
        track.artists = formatArtistsList(matchedTrack.artists);
      }
      if (!track.album || track.album === 'Spotify Album') {
        track.album = matchedTrack.albumName;
      }
      if (!track.imageUrl && matchedTrack.image?.url) {
        track.imageUrl = matchedTrack.image.url;
      }
      if ((!track.durationMs || track.durationMs === 240000) && matchedTrack.durationMs) {
        track.durationMs = matchedTrack.durationMs;
        view = { ...next, track, durationMs: matchedTrack.durationMs };
      } else {
        view = { ...next, track };
      }
    } else if (
      next.track.name.startsWith('Track ') ||
      next.track.artists?.[0] === 'Spotify Artist' ||
      next.track.artists?.[0] === 'Unknown Artist'
    ) {
      const trackId = uri.replace('spotify:track:', '');
      if (trackId && trackId.length <= 64) {
        void clients.webApi
          .getTrackView(trackId)
          .then(async (res) => {
            if (res.type === 'track' && res.completeness === 'complete') {
              const t = res.track;
              const ui = getUi();
              if (state.currentInfo.playback?.track?.uri === uri && ui) {
                const enriched: TrackT = {
                  ...(state.currentInfo.playback.track ?? next.track),
                  name: t.name,
                  artists: t.artists.map((a) => a.name),
                  album: t.albumName,
                  durationMs: t.durationMs,
                  imageUrl:
                    t.image?.url ?? (state.currentInfo.playback?.track ?? next.track).imageUrl,
                };
                const firstA = t.artists[0];
                if (firstA?.id) {
                  const g = await resolveTrackGenre(firstA.id);
                  if (g && state.currentInfo.playback?.track?.uri === uri) {
                    enriched.genre = g;
                  }
                }
                ui.setPlayback({
                  ...state.currentInfo.playback,
                  track: enriched,
                  durationMs: t.durationMs,
                });
              }
            }
          })
          .catch(() => {});
      }
    }

    if (!view.track?.genre && matched && 'artists' in matched && Array.isArray(matched.artists)) {
      const firstArtist = matched.artists[0];
      const artistId = firstArtist?.id;
      if (artistId) {
        const trackUri = view.track?.uri ?? uri;
        void resolveTrackGenre(artistId)
          .then((g) => {
            const ui = getUi();
            if (g && ui && state.currentInfo.playback?.track?.uri === trackUri) {
              ui.setPlayback({
                ...state.currentInfo.playback,
                track: { ...(state.currentInfo.playback?.track ?? next.track), genre: g },
              });
            }
          })
          .catch(() => {});
      }
    }

    return view;
  };

  return { resolveTrackGenre, enrichPlaybackTrack };
}
