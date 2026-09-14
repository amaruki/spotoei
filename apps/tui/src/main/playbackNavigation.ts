import type { CatalogTrackT } from 'spotoei-protocol';

import { logToFile } from '../config';
import type { PlaybackCore } from './playbackCore';
import type { AppContext } from './types';

export function createNavigationActions(ctx: AppContext, core: PlaybackCore) {
  const { clients, state, getUi } = ctx;
  const { getEffectivePlayback, playTrackOrContext } = core;

  const nextTrack = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const qSnap = clients.queueManager.getSnapshot();
    if (qSnap.upcoming.length > 0) {
      const nextItem = qSnap.upcoming[0];
      if (!nextItem) return;
      ui?.setStatus(`▶ Next: ${nextItem.track.name}`);
      await playTrackOrContext({
        trackUri: nextItem.track.uri,
        title: nextItem.track.name,
      });
      return;
    }

    let tracksToUse: CatalogTrackT[] =
      state.activePlaylistTracks.length > 0
        ? state.activePlaylistTracks
        : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
    if (tracksToUse.length > 0) {
      const curUri = curPlayback?.track?.uri;
      let curIdx = tracksToUse.findIndex((item) => item.uri === curUri);

      if (curIdx >= tracksToUse.length - 2 && curPlayback?.autoplay) {
        const beforeLen = tracksToUse.length;
        // refresh on next call
        tracksToUse =
          state.activePlaylistTracks.length > 0
            ? state.activePlaylistTracks
            : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
        if (tracksToUse.length === beforeLen) {
          // no growth; continue
        }
        curIdx = tracksToUse.findIndex((item) => item.uri === curUri);
      }

      let nextIdx = 0;
      if (curPlayback?.shuffle) {
        nextIdx = Math.floor(Math.random() * tracksToUse.length);
      } else if (curIdx !== -1) {
        nextIdx = (curIdx + 1) % tracksToUse.length;
      }
      const nextItem = tracksToUse[nextIdx];
      if (nextItem) {
        ui?.setStatus(`▶ Next: ${nextItem.name}`);
        await playTrackOrContext({
          trackUri: nextItem.uri,
          title: nextItem.name,
        });
        return;
      }
    }

    try {
      if (clients.webApi && typeof clients.webApi.nextTrack === 'function') {
        void clients.webApi.nextTrack().catch(() => {});
      }
      const res = await clients.playback.next();
      if (res.track) {
        ui?.setStatus(`▶ Next: ${res.track.name}`);
      }
    } catch (err) {
      logToFile(`[Next Error] ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const previousTrack = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const curPos = curPlayback?.positionMs ?? 0;
    if (curPos > 3000) {
      if (clients.webApi && typeof clients.webApi.seek === 'function') {
        void clients.webApi.seek(0).catch(() => {});
      }
      await clients.playback.seek(0).catch(() => {});
      ui?.setStatus('⏮ Restarted track');
      return;
    }

    const tracksToUse: CatalogTrackT[] =
      state.activePlaylistTracks.length > 0
        ? state.activePlaylistTracks
        : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
    if (tracksToUse.length > 0) {
      const curUri = curPlayback?.track?.uri;
      const curIdx = tracksToUse.findIndex((item) => item.uri === curUri);
      const prevIdx = curIdx > 0 ? curIdx - 1 : tracksToUse.length - 1;
      const prevItem = tracksToUse[prevIdx];
      if (prevItem) {
        ui?.setStatus(`⏮ Previous: ${prevItem.name}`);
        await playTrackOrContext({
          trackUri: prevItem.uri,
          title: prevItem.name,
        });
        return;
      }
    }

    try {
      if (clients.webApi && typeof clients.webApi.previousTrack === 'function') {
        void clients.webApi.previousTrack().catch(() => {});
      }
      const res = await clients.playback.previous();
      if (res.track) {
        ui?.setStatus(`⏮ Previous: ${res.track.name}`);
      }
    } catch (err) {
      logToFile(`[Previous Error] ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return { nextTrack, previousTrack };
}
