import type { CatalogTrackT } from 'spotoei-protocol';

import { logToFile } from '../config';
import { optimisticPlayback } from '../playback/validator';
import type { AppContext } from './types';

export interface PlayTrackMeta {
  durationMs?: number;
  artists?: string[];
  album?: string;
}

export interface PlayTrackOpts {
  trackUri?: string;
  contextUri?: string;
  title: string;
  meta?: PlayTrackMeta;
}

export function createPlaybackActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const getEffectivePlayback = () =>
    optimisticPlayback.getEffectiveState() ?? state.currentInfo.playback;

  // Real catalog metadata for a locally known track. The sidecar falls
  // back to a 240s placeholder duration otherwise, which breaks its
  // end-of-track detection (idle fires late, or mid-track for long
  // songs) — so autoplay-next never lands on time.
  const lookupMeta = (trackUri: string): PlayTrackMeta | undefined => {
    const poolHit = state.activePlaylistTracks.find((t) => t.uri === trackUri);
    if (poolHit) {
      return {
        durationMs: poolHit.durationMs,
        artists: poolHit.artists?.map((a) => a.name) ?? [],
        album: poolHit.albumName,
      };
    }
    const libHit = state.libraryItems.find((it) => it.uri === trackUri);
    if (libHit) {
      return {
        durationMs: libHit.durationMs,
        artists: libHit.artists?.map((a) => a.name) ?? [],
        album: libHit.albumName,
      };
    }
    return undefined;
  };

  const playTrackOrContext = async (opts: PlayTrackOpts): Promise<void> => {
    const ui = getUi();
    const meta = opts.meta ?? (opts.trackUri ? lookupMeta(opts.trackUri) : undefined);

    // Connect context for remote devices: the current track first, then the
    // rest of the active pool in order. Falls back to the played track alone
    // when it is not part of the pool.
    const poolUris = state.activePlaylistTracks.map((t) => t.uri);
    const poolIdx = opts.trackUri ? poolUris.indexOf(opts.trackUri) : -1;
    const queueUris =
      opts.trackUri && poolIdx >= 0
        ? poolUris.slice(poolIdx)
        : opts.trackUri
          ? [opts.trackUri]
          : [];
    let parsedTitle = opts.title;
    let parsedArtists = meta?.artists;
    if (opts.title.includes(' — ')) {
      const parts = opts.title.split(' — ');
      parsedTitle = parts[0]?.trim() || opts.title;
      if (!parsedArtists || parsedArtists.length === 0) {
        const extraArtist = parts[1]?.trim();
        if (extraArtist) parsedArtists = [extraArtist];
      }
    }
    const loadMeta = {
      name: parsedTitle,
      ...(parsedArtists && parsedArtists.length > 0 ? { artists: parsedArtists } : {}),
      ...(meta?.durationMs && meta.durationMs > 0 ? { durationMs: meta.durationMs } : {}),
      ...(meta?.album ? { album: meta.album } : {}),
    };
    let nativeSuccess = false;
    try {
      await clients.playback.load({
        trackUri: opts.trackUri,
        contextUri: opts.contextUri,
        queueUris,
        autoplay: true,
        ...loadMeta,
      });
      nativeSuccess = true;
      ui?.setStatus(`▶ Playing: ${opts.title}`);
    } catch (err) {
      logToFile(`[Native Play Error] ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!nativeSuccess) {
      try {
        if (opts.trackUri) {
          await clients.webApi.play({ uris: [opts.trackUri] });
        } else if (opts.contextUri) {
          await clients.webApi.play({ context_uri: opts.contextUri });
        }
        ui?.setStatus(`▶ Playing: ${opts.title}`);
      } catch (webErr) {
        logToFile(`[Web Play Error] ${webErr instanceof Error ? webErr.message : String(webErr)}`);
        ui?.setStatus(
          `Play failed: ${webErr instanceof Error ? webErr.message : String(webErr)}`,
          true,
        );
      }
    }
  };
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

  const toggleShuffle = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const next = !curPlayback?.shuffle;
    try {
      if (clients.webApi && typeof clients.webApi.shuffle === 'function') {
        void clients.webApi.shuffle(next).catch(() => {});
      }
      await clients.playback.setShuffle(next);
      ui?.setStatus(`Shuffle: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`shuffle: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleRepeat = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.repeat ?? 'off';
    const next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
    try {
      if (clients.webApi && typeof clients.webApi.repeat === 'function') {
        void clients.webApi.repeat(next).catch(() => {});
      }
      await clients.playback.setRepeat(next);
      ui?.setStatus(`Repeat: ${next.toUpperCase()}`);
    } catch (e) {
      ui?.setStatus(`repeat: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleAutoplay = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const next = !curPlayback?.autoplay;
    try {
      await clients.playback.setAutoplay(next);
      ui?.setStatus(`Autoplay: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`autoplay: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const seekRelative = async (deltaMs: number): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.positionMs ?? 0;
    const dur = curPlayback?.durationMs ?? 0;
    const nextPos = Math.max(0, Math.min(dur > 0 ? dur : cur + deltaMs, cur + deltaMs));
    try {
      if (clients.webApi && typeof clients.webApi.seek === 'function') {
        void clients.webApi.seek(nextPos).catch(() => {});
      }
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
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.volume ?? 0.8;
    const nextVol = Math.round(Math.max(0.0, Math.min(1.0, cur + delta)) * 100) / 100;
    try {
      if (clients.webApi && typeof clients.webApi.setVolume === 'function') {
        void clients.webApi.setVolume(Math.round(nextVol * 100)).catch(() => {});
      }
      await clients.playback.setVolume(nextVol);
      ui?.setStatus(`Volume: ${Math.round(nextVol * 100)}%`);
    } catch (e) {
      ui?.setStatus(`volume: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const play = async (): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.play === 'function') {
        void clients.webApi.play({}).catch(() => {});
      }
      await clients.playback.play();
    } catch (e) {
      ui?.setStatus(`play: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pause = async (): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.pause === 'function') {
        void clients.webApi.pause().catch(() => {});
      }
      await clients.playback.pause();
    } catch (e) {
      ui?.setStatus(`pause: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const togglePlayPause = async (): Promise<void> => {
    const pb = getEffectivePlayback();
    if (pb?.state === 'playing') {
      await pause();
    } else {
      await play();
    }
  };

  const seek = async (positionMs: number): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.seek === 'function') {
        void clients.webApi.seek(positionMs).catch(() => {});
      }
      await clients.playback.seek(positionMs);
      const secs = Math.floor(positionMs / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      ui?.setStatus(`Seek: ${mins}:${remSecs.toString().padStart(2, '0')}`);
    } catch (e) {
      ui?.setStatus(`seek: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const playRadio = async (opts: { seedUri: string; title?: string }): Promise<void> => {
    const ui = getUi();
    const { seedUri, title } = opts;
    ui?.setStatus(`Starting radio for ${title ?? seedUri}…`);

    let tracks: CatalogTrackT[] = [];
    const isTrack = seedUri.startsWith('spotify:track:');
    const isArtist = seedUri.startsWith('spotify:artist:');
    const id = seedUri.split(':').pop();

    if (id) {
      try {
        if (isTrack) {
          tracks = await clients.webApi.getRecommendations({ seedTracks: [id], limit: 25 });
        } else if (isArtist) {
          tracks = await clients.webApi.getRecommendations({ seedArtists: [id], limit: 25 });
        }
      } catch (err) {
        logToFile(
          `[Radio Error] Failed recommendations: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (tracks.length === 0 && (isArtist || title)) {
      try {
        const query = title ? title.replace(/\s+Radio$/i, '') : (id ?? '');
        const searchHits = await clients.webApi.search(query, ['track'], 25);
        if (Array.isArray(searchHits)) {
          tracks = searchHits
            .filter(
              (h: unknown): h is Record<string, unknown> =>
                typeof h === 'object' && h !== null && ('type' in h || 'durationMs' in h),
            )
            .map((h) => ('type' in h && h.track ? h.track : h) as unknown as CatalogTrackT);
        }
      } catch (err) {
        logToFile(
          `[Radio Error] Fallback search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (tracks.length === 0) {
      ui?.setStatus(`No radio tracks found for ${title ?? seedUri}`, true);
      return;
    }

    state.activePlaylistTracks = tracks;
    const firstTrack = tracks[0];
    if (firstTrack?.uri) {
      await playTrackOrContext({
        trackUri: firstTrack.uri,
        title: firstTrack.name,
      });
      ui?.setStatus(`▶ Radio: ${title ?? firstTrack.name}`);
    }
  };

  return {
    playTrackOrContext,
    playRadio,
    nextTrack,
    previousTrack,
    toggleShuffle,
    toggleRepeat,
    toggleAutoplay,
    seekRelative,
    changeVolume,
    play,
    pause,
    togglePlayPause,
    seek,
  };
}
