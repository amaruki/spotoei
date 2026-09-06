import type { CatalogTrackT } from 'spotoei-protocol';

import { logToFile } from '../config';
import { resolveQueueView } from '../queue';
import type { AppContext } from './types';

export function createQueueActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const updateQueueView = async (): Promise<void> => {
    const ui = getUi();
    // Always forward the canonical player queue — do not synthesize.
    await clients.queueManager.refresh().catch(() => {});
    const qSnap = clients.queueManager.getSnapshot();
    // Render the real upcoming tracks: cloud queue when Connect playback
    // makes it authoritative, otherwise the local pool.
    if (ui)
      ui.setQueueSnapshot(
        resolveQueueView(
          qSnap,
          state.activePlaylistTracks,
          state.currentInfo.playback?.track ?? null,
        ),
      );
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

      // 2. Fallback: Search for more tracks by artists in the current pool.
      // Mixed across up to 3 artists so the result feels like radio,
      // not one artist on loop. Pool/current URIs are excluded.
      if (newTracks.length === 0) {
        const names: string[] = [];
        const seenNames = new Set<string>();
        const pushName = (value: unknown): void => {
          if (typeof value !== 'string') return;
          const cleaned = value.trim();
          if (
            !cleaned ||
            cleaned === 'Spotify Artist' ||
            cleaned === 'Test Artist' ||
            cleaned === 'Unknown Artist' ||
            seenNames.has(cleaned)
          ) {
            return;
          }
          seenNames.add(cleaned);
          names.push(cleaned);
        };
        for (const artist of curTrack?.artists ?? []) pushName(artist);
        for (const item of pool) {
          if (names.length >= 3) break;
          for (const artist of item.artists ?? []) {
            pushName(typeof artist === 'string' ? artist : artist?.name);
          }
        }
        if (names.length > 0) {
          const existingUris = new Set(pool.map((t) => t.uri));
          if (curUri) existingUris.add(curUri);
          const results = await Promise.all(
            names
              .slice(0, 3)
              .map((name) => clients.webApi.search(name, ['track'], 5).catch(() => null)),
          );
          const merged: CatalogTrackT[] = [];
          const seenTracks = new Set<string>();
          for (const res of results) {
            for (const hit of res?.hits ?? []) {
              if (hit.type !== 'track') continue;
              if (existingUris.has(hit.track.uri) || seenTracks.has(hit.track.uri)) continue;
              seenTracks.add(hit.track.uri);
              merged.push(hit.track);
            }
          }
          newTracks = merged.toSorted(() => 0.5 - Math.random()).slice(0, 15);
        }
      }

      // 3. Fallback: Saved Library Tracks
      if (newTracks.length === 0) {
        const trackPool = state.libraryItems.filter(
          (libItem): libItem is CatalogTrackT =>
            'durationMs' in libItem && typeof (libItem as CatalogTrackT).albumName === 'string',
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
