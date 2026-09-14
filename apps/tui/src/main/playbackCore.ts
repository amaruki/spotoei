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

export function createPlaybackCore(ctx: AppContext) {
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
    const hasStreaming =
      state.hasStreaming ??
      (typeof clients?.auth?.streamingStatus === 'function'
        ? await clients.auth.streamingStatus().catch(() => false)
        : true);
    state.hasStreaming = hasStreaming;
    if (!hasStreaming) {
      ui?.setStatus('Audio not authorized — press a to complete Step 2/2', true);
      return;
    }

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
      ui?.setStatus(`⏳ Loading: ${opts.title}`);
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

  return { getEffectivePlayback, playTrackOrContext };
}

export type PlaybackCore = ReturnType<typeof createPlaybackCore>;
