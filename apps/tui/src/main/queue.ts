import type { CatalogTrackT, QueueItemT } from 'spotoei-protocol';

import { logToFile } from '../config';
import type { AppContext } from './types';

export function createQueueActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const updateQueueView = async (): Promise<void> => {
    const ui = getUi();
    // 1. Attempt to refresh canonical Spotify queue from webApi
    await clients.queueManager.refresh().catch(() => {});
    const qSnap = clients.queueManager.getSnapshot();
    if (qSnap.upcoming.length > 0) {
      if (ui) ui.setQueueSnapshot(qSnap);
      return;
    }

    // 2. Synthesize queue from activePlaylistTracks or libraryItems
    const pool: CatalogTrackT[] =
      state.activePlaylistTracks.length > 0
        ? state.activePlaylistTracks
        : state.libraryItems.filter((libItem): libItem is CatalogTrackT => 'durationMs' in libItem);
    if (pool.length > 0 && ui) {
      const curUri = state.currentInfo.playback?.track?.uri;
      const curIdx = pool.findIndex((t) => t.uri === curUri);
      const upcomingList: QueueItemT[] = [];
      const startIdx = curIdx >= 0 ? curIdx + 1 : 0;
      const count = Math.min(pool.length, startIdx + 50);
      for (let i = startIdx; i < count; i++) {
        const t = pool[i];
        if (t) {
          const artists = t.artists.map((a) => ({ id: a.id, name: a.name, uri: a.uri }));
          upcomingList.push({
            id: `${t.uri}-${i}`,
            track: {
              id: t.id,
              name: t.name,
              uri: t.uri,
              artists,
              durationMs: t.durationMs,
            },
            source: 'autoplay',
            addedAt: Date.now(),
          });
        }
      }
      ui.setQueueSnapshot({
        current: state.currentInfo.playback?.track
          ? {
              id: state.currentInfo.playback.track.uri.replace('spotify:track:', ''),
              name: state.currentInfo.playback.track.name,
              uri: state.currentInfo.playback.track.uri,
              artists: state.currentInfo.playback.track.artists.map((name) => ({
                id: name,
                name,
                uri: '',
              })),
              durationMs: state.currentInfo.playback.durationMs,
            }
          : null,
        upcoming: upcomingList,
        revision: qSnap.revision + 1,
      });
    }
  };

  const ensureAutoplayTracks = async (): Promise<void> => {
    if (state.isFetchingAutoplay) return;
    if (!state.currentInfo.playback?.autoplay) return;

    const pool: CatalogTrackT[] =
      state.activePlaylistTracks.length > 0
        ? state.activePlaylistTracks
        : state.libraryItems.filter((libItem): libItem is CatalogTrackT => 'durationMs' in libItem);
    const curTrack = state.currentInfo.playback?.track;
    const curUri = curTrack?.uri;
    const curIdx = pool.findIndex((t) => t.uri === curUri);
    const remaining = curIdx >= 0 ? pool.length - 1 - curIdx : 0;

    // When fewer than 5 tracks remain in the active pool, fetch more
    if (remaining >= 5) return;

    state.isFetchingAutoplay = true;
    try {
      let newTracks: CatalogTrackT[] = [];
      const trackId = curUri?.replace('spotify:track:', '');

      // 1. Try Spotify Recommendations API with seed track
      if (trackId && !trackId.startsWith('sample') && !trackId.startsWith('ctx-')) {
        newTracks = await clients.webApi.getRecommendations({ seedTracks: [trackId], limit: 20 });
      }

      // 2. Fallback: Search for more tracks by the current artist
      if (newTracks.length === 0 && curTrack?.artists && curTrack.artists.length > 0) {
        const firstArtist = curTrack.artists[0];
        const artistName = typeof firstArtist === 'string' ? firstArtist : undefined;
        if (artistName && artistName !== 'Spotify Artist' && artistName !== 'Test Artist') {
          const searchRes = await clients.webApi.search(artistName, ['track'], 10);
          newTracks = searchRes.hits
            .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
            .map((h) => h.track);
        }
      }

      // 3. Fallback: Saved Library Tracks
      if (newTracks.length === 0) {
        const trackPool: CatalogTrackT[] = state.libraryItems.filter(
          (libItem): libItem is CatalogTrackT => 'durationMs' in libItem,
        );
        if (trackPool.length > 0) {
          const existingUris = new Set(pool.map((t) => t.uri));
          const unplayed = trackPool.filter((t) => !existingUris.has(t.uri));
          const candidates = unplayed.length > 0 ? unplayed : trackPool;
          const shuffled = candidates.toSorted(() => 0.5 - Math.random());
          newTracks = shuffled.slice(0, 15);
        }
      }

      if (newTracks.length > 0) {
        const existingUris = new Set(state.activePlaylistTracks.map((t) => t.uri));
        const added = newTracks.filter((t) => !existingUris.has(t.uri));
        if (added.length > 0) {
          state.activePlaylistTracks.push(...added);
          logToFile(`[Autoplay] Appended ${added.length} tracks to queue`);
          void updateQueueView();
        }
      }
    } catch (e) {
      logToFile(`[Autoplay Error] ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      state.isFetchingAutoplay = false;
    }
  };

  return { updateQueueView, ensureAutoplayTracks };
}
