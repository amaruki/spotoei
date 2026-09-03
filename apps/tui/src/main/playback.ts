import type { CatalogTrackT } from 'spotoei-protocol';

import { logToFile } from '../config';
import type { AppContext } from './types';

export function createPlaybackActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const playTrackOrContext = async (opts: {
    trackUri?: string;
    contextUri?: string;
    title: string;
  }): Promise<void> => {
    const ui = getUi();
    try {
      await clients.playback.load({
        trackUri: opts.trackUri,
        contextUri: opts.contextUri,
        autoplay: true,
      });
      ui?.setStatus(`▶ Playing: ${opts.title}`);
      return;
    } catch (err) {
      logToFile(`[Native Play Error] ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      if (opts.trackUri) {
        await clients.webApi.play({ uris: [opts.trackUri] });
      } else if (opts.contextUri) {
        await clients.webApi.play({ context_uri: opts.contextUri });
      }
      ui?.setStatus(`▶ Playing on Spotify: ${opts.title}`);
      return;
    } catch (webErr) {
      logToFile(`[Web Play Error] ${webErr instanceof Error ? webErr.message : String(webErr)}`);
    }
  };

  const nextTrack = async (): Promise<void> => {
    const ui = getUi();
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

    let tracksToUse: CatalogTrackT[] = state.activePlaylistTracks.length > 0
      ? state.activePlaylistTracks
      : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
    if (tracksToUse.length > 0) {
      const curUri = state.currentInfo.playback?.track?.uri;
      let curIdx = tracksToUse.findIndex((item) => item.uri === curUri);

      if (curIdx >= tracksToUse.length - 2 && state.currentInfo.playback?.autoplay) {
        const beforeLen = tracksToUse.length;
        // refresh on next call
        tracksToUse = state.activePlaylistTracks.length > 0
          ? state.activePlaylistTracks
          : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
        if (tracksToUse.length === beforeLen) {
          // no growth; continue
        }
        curIdx = tracksToUse.findIndex((item) => item.uri === curUri);
      }

      let nextIdx = 0;
      if (state.currentInfo.playback?.shuffle) {
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
      await clients.webApi.nextTrack().catch(() => {});
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
    const curPos = state.currentInfo.playback?.positionMs ?? 0;
    if (curPos > 3000) {
      await clients.playback.seek(0).catch(() => {});
      ui?.setStatus('⏮ Restarted track');
      return;
    }

    const tracksToUse: CatalogTrackT[] = state.activePlaylistTracks.length > 0
      ? state.activePlaylistTracks
      : state.libraryItems.filter((it): it is CatalogTrackT => 'durationMs' in it);
    if (tracksToUse.length > 0) {
      const curUri = state.currentInfo.playback?.track?.uri;
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
      await clients.webApi.previousTrack().catch(() => {});
      const res = await clients.playback.previous();
      if (res.track) {
        ui?.setStatus(`⏮ Previous: ${res.track.name}`);
      }
    } catch (err) {
      logToFile(`[Previous Error] ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleShuffle = async (): Promise<void> => {
    const ui = getUi();
    const next = !state.currentInfo.playback?.shuffle;
    try {
      if (clients.webApi && typeof clients.webApi.shuffle === 'function') {
        await clients.webApi.shuffle(next).catch(() => {});
      }
      await clients.playback.setShuffle(next);
      ui?.setStatus(`Shuffle: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`shuffle: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleRepeat = async (): Promise<void> => {
    const ui = getUi();
    const cur = state.currentInfo.playback?.repeat ?? 'off';
    const next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
    try {
      if (clients.webApi && typeof clients.webApi.repeat === 'function') {
        await clients.webApi.repeat(next).catch(() => {});
      }
      await clients.playback.setRepeat(next);
      ui?.setStatus(`Repeat: ${next.toUpperCase()}`);
    } catch (e) {
      ui?.setStatus(`repeat: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleAutoplay = async (): Promise<void> => {
    const ui = getUi();
    const next = !state.currentInfo.playback?.autoplay;
    try {
      await clients.playback.setAutoplay(next);
      ui?.setStatus(`Autoplay: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`autoplay: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const seekRelative = async (deltaMs: number): Promise<void> => {
    const ui = getUi();
    const cur = state.currentInfo.playback?.positionMs ?? 0;
    const dur = state.currentInfo.playback?.durationMs ?? 0;
    const nextPos = Math.max(0, Math.min(dur > 0 ? dur : cur + deltaMs, cur + deltaMs));
    try {
      await clients.playback.seek(nextPos);
      const secs = Math.floor(nextPos / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      ui?.setStatus(`Seek: ${mins}:${remSecs.toString().padStart(2, '0')}`);
    } catch (e) {
      ui?.setStatus(`seek: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeVolume = async (delta: number): Promise<void> => {
    const ui = getUi();
    const cur = state.currentInfo.playback?.volume ?? 0.8;
    const nextVol = Math.round(Math.max(0.0, Math.min(1.0, cur + delta)) * 100) / 100;
    try {
      await clients.playback.setVolume(nextVol);
      ui?.setStatus(`Volume: ${Math.round(nextVol * 100)}%`);
    } catch (e) {
      ui?.setStatus(`volume: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    playTrackOrContext,
    nextTrack,
    previousTrack,
    toggleShuffle,
    toggleRepeat,
    toggleAutoplay,
    seekRelative,
    changeVolume,
  };
}
