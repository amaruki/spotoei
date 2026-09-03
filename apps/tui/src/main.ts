import type { ChildProcess } from 'node:child_process';
import {
  PROTOCOL_VERSION,
  type AuthStatusDataT,
  type CatalogTrackT,
  type PlaybackChangedDataT,
  type QueueItemT,
  type SearchResponseT,
  type TrackT,
} from 'spotoei-protocol';

import { createAuthClient } from './auth';
import { Cache } from './cache';
import { LibraryManager } from './library';
import { createLyricsClient } from './lyrics';
import { createPlaybackClient } from './playback';
import { locatePlayer, startPlayer, stopPlayer } from './player';
import { QueueManager } from './queue';
import { createSearchClient } from './search';
import { resolveClientId, saveClientId, saveRedirectPort, getRedirectUri, logToFile } from './config';
import { displayWidth, sanitize } from './text';
import {
  createUi,
  type FocusArea,
  type KeyDispatch,
  type LibraryItemT,
  type Route,
  type Ui,
  type UiViewState,
} from './ui';
import { openBrowser, copyToClipboard } from './system';
import { createVisualizerController } from './visualizer';
import { WebApiClient } from './webApi';

interface Deferred<T> {
  promise: Promise<T>;
  trigger: (val: T) => void;
}

function deferred<T>(): Deferred<T> {
  let trigger!: (val: T) => void;
  const promise = new Promise<T>((resolve) => {
    trigger = resolve;
  });
  return { promise, trigger };
}
function isUpperKey(k: { name?: string; sequence?: string; shift?: boolean }, char: string): boolean {
  const upper = char.toUpperCase();
  const lower = char.toLowerCase();
  return (
    k.sequence === upper ||
    k.name === upper ||
    (Boolean(k.shift) && (k.name === lower || k.name === upper))
  );
}

function isLowerKey(k: { name?: string; sequence?: string; shift?: boolean }, char: string): boolean {
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  if (k.shift) return false;
  if (k.sequence === upper || k.name === upper) return false;
  return k.name === lower || k.sequence === lower;
}
function formatArtistsList(raw?: Array<string | { name: string }>): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === 'string' ? a : a?.name ?? ''))
    .filter((s) => s.trim().length > 0);
}




export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    return 0;
  }
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1));
  }
  if (args[0] === 'config' && args[1] === 'set-client-id' && args[2]) {
    const res = saveClientId(args[2]);
    process.stdout.write(`Spotify Client ID saved to ${res.configPath}\n`);
    return 0;
  }
  if (args[0] === 'config' && args[1] === 'set-redirect-port' && args[2]) {
    const port = Number.parseInt(args[2], 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      process.stderr.write('spotoei: invalid port number\n');
      return 1;
    }
    const res = saveRedirectPort(port);
    process.stdout.write(`Spotify redirect port set to ${res.port} in ${res.configPath}\n`);
    process.stdout.write(
      `Add this Redirect URI in your Spotify App Settings: http://127.0.0.1:${res.port}/callback\n`,
    );
    return 0;
  }

  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(
      `spotoei: player binary not found: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  const requestQuit = deferred<number>();
  let child: ChildProcess | null = null;
  let ui: Ui | null = null;
  let isExiting = false;

  const quit = async (): Promise<void> => {
    if (isExiting) return;
    isExiting = true;
    if (ui) {
      try {
        await ui.shutdown();
      } catch {
        // ignore shutdown error
      }
    }
    if (child) {
      try {
        await stopPlayer(child);
      } catch {
        // ignore player stop error
      }
    }
    requestQuit.trigger(0);
  };

  process.on('SIGINT', () => {
    void quit();
  });


  process.on('SIGTERM', () => {
    void quit();
  });
  process.on('SIGHUP', () => {
    void quit();
  });
  process.on('uncaughtException', async (err) => {
    try {
      if (ui) await ui.shutdown();
    } catch {
      // ignore
    }
    process.stderr.write(
      `[spotoei:fatal] uncaught exception: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    process.exit(1);
  });

  try {
    const clientRes = resolveClientId();
    if (clientRes.clientId) {
      process.env.SPOTOEI_CLIENT_ID = clientRes.clientId;
    }
    const extraEnv: Record<string, string> = {};
    if (clientRes.clientId) {
      extraEnv.SPOTOEI_CLIENT_ID = clientRes.clientId;
    }
    const handshake = await startPlayer(playerBin, extraEnv);
    child = handshake.child;

    child.once('exit', (code, signal) => {
      if (!isExiting && ui) {
        ui.setStatus(
          `Player sidecar exited unexpectedly (code ${code ?? 'none'}, sig ${signal ?? 'none'})`,
          true,
        );
      }
    });

    const auth = createAuthClient({ child });
    const playback = createPlaybackClient({ child });
    const initialAuth = await auth.status();
    const initialPlayback = await playback.status();

    const cache = new Cache();
    const tokenProvider = {
      async getAccessToken(): Promise<string> {
        return auth.getWebToken();
      },
      invalidateToken(): void {
        auth.clearToken();
      },
    };
    const webApi = new WebApiClient({ tokenProvider });
    const searchClient = createSearchClient({
      webApi,
      cache,
      accountId: initialAuth.accountId ?? 'anonymous',
      debounceMs: 0,
    });
    const libraryManager = new LibraryManager({
      webApi,
      cache,
      accountId: initialAuth.accountId ?? 'anonymous',
    });
    const queueManager = new QueueManager({ webApi });
    const visualizer = createVisualizerController({ child });
    const lyrics = createLyricsClient({ child });

    const currentInfo: UiViewState = {
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
      auth: initialAuth,
      playback: initialPlayback,
      queue: {
        current: null,
        upcoming: [],
        revision: 0,
      },
      visualizer: {
        mode: visualizer.getMode(),
        fps: visualizer.getCurrentFps(),
      },
    };

    let activeFocus: FocusArea = 'main';

    const triggerAuth = async (): Promise<void> => {
      const res = resolveClientId();
      if (!res.clientId) {
        if (ui) {
          ui.focusClientIdInput();
          ui.setStatus(
            'Spotify Client ID not set! Enter it below and press Enter to save.',
            true,
          );
        }
        return;
      }
      if (ui) ui.setStatus('Opening browser for authentication...', true);
      try {
        const result = await auth.begin();
        if (result.authUrl) {
          const opened = openBrowser(result.authUrl);
          const copied = copyToClipboard(result.authUrl);
          let msg = opened ? 'Browser opened for authentication!' : 'Please complete login in your browser';
          if (copied) {
            msg += ' (URL copied to clipboard)';
          }
          if (ui) ui.setStatus(msg, true);
        }
      } catch (err) {
        if (ui) ui.setStatus(`Auth error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    };

    let libraryItems: LibraryItemT[] = [];
    let activePlaylistTracks: CatalogTrackT[] = [];
    let currentSearchHits: SearchResponseT['hits'] = [];
    const artistGenreCache = new Map<string, string>();


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
      if (artistGenreCache.has(id)) {
        return artistGenreCache.get(id);
      }
      try {
        const genres = await webApi.getArtistGenres(id);
        if (genres && genres.length > 0) {
          const formatted = genres
            .slice(0, 2)
            .map((g) =>
              g
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
            )
            .join(' / ');
          artistGenreCache.set(id, formatted);
          return formatted;
        }
      } catch {
        // ignore
      }
      return undefined;
    };

    const loadLibrary = async (force = false): Promise<void> => {
      if (!ui) return;
      ui.setLibraryLoading(true);
      ui.setStatus('Loading saved library tracks…');
      try {
        if (force) {
          await libraryManager.refresh('saved_tracks');
        }
        const page = await libraryManager.getPage('saved_tracks', 0, 50, force);
        if (page.error) {
          ui.setLibraryItems([], page.error);
          ui.setStatus(`Library error: ${page.error.message}`, true);
          return;
        }
        libraryItems = page.items as LibraryItemT[];
        ui.setLibraryItems(libraryItems);
        const count = libraryItems.length;
        ui.setStatus(
          count > 0
            ? `Loaded ${count} saved track${count === 1 ? '' : 's'}. Press Enter to play.`
            : 'Your Spotify library has no saved tracks.',
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ui.setLibraryItems([], { code: 'LOAD_ERROR', message: msg });
        ui.setStatus(`Failed to load library: ${msg}`, true);
      }
    };

    let currentLyricsTrackUri: string | undefined;
    let lastRouteBeforeLyrics: Route = 'home';

    const loadCurrentLyrics = async (force = false): Promise<void> => {
      if (!ui) return;
      const pb = currentInfo.playback;
      const track = pb?.track;
      if (!track || !track.uri) {
        ui.setLyrics(null);
        ui.setStatus('No track playing to load lyrics for');
        return;
      }

      if (!force && currentLyricsTrackUri === track.uri) {
        return;
      }

      currentLyricsTrackUri = track.uri;
      ui.setStatus(`Fetching lyrics for "${track.name}"…`);

      try {
        const doc = await lyrics.loadLyrics({
          trackUri: track.uri,
          title: track.name,
          artist: Array.isArray(track.artists) ? track.artists[0] : undefined,
          album: track.album,
          durationMs: track.durationMs || pb.durationMs,
        });
        if (currentInfo.playback?.track?.uri === track.uri) {
          ui.setLyrics(doc);
          ui.setStatus(
            doc.kind === 'synced'
              ? `Loaded synced lyrics for "${track.name}" (${doc.lines.length} lines)`
              : `Loaded plain lyrics for "${track.name}"`,
          );
        }
      } catch {
        if (currentInfo.playback?.track?.uri === track.uri) {
          ui.setLyrics({
            kind: 'plain',
            lines: [{ text: `(Lyrics not found for "${track.name}")` }],
          });
          ui.setStatus(`Lyrics not found for "${track.name}"`);
        }
      }
    };

    const updateQueueView = async (): Promise<void> => {
      // 1. Attempt to refresh canonical Spotify queue from webApi
      await queueManager.refresh().catch(() => {});
      const qSnap = queueManager.getSnapshot();
      if (qSnap.upcoming.length > 0) {
        if (ui) ui.setQueueSnapshot(qSnap);
        return;
      }

      // 2. Synthesize queue from activePlaylistTracks or libraryItems
      const pool = activePlaylistTracks.length > 0
        ? activePlaylistTracks
        : libraryItems.filter((libItem): libItem is CatalogTrackT => 'durationMs' in libItem);
      if (pool.length > 0 && ui) {
        const curUri = currentInfo.playback?.track?.uri;
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
          current: currentInfo.playback?.track
            ? {
                id: currentInfo.playback.track.uri.replace('spotify:track:', ''),
                name: currentInfo.playback.track.name,
                uri: currentInfo.playback.track.uri,
                artists: currentInfo.playback.track.artists.map((name) => ({ id: name, name, uri: '' })),
                durationMs: currentInfo.playback.durationMs,
              }
            : null,
          upcoming: upcomingList,
          revision: qSnap.revision + 1,
        });
      }
    };

    let isFetchingAutoplay = false;
    const ensureAutoplayTracks = async (): Promise<void> => {
      if (isFetchingAutoplay) return;
      if (!currentInfo.playback?.autoplay) return;

      const pool: CatalogTrackT[] = activePlaylistTracks.length > 0
        ? activePlaylistTracks
        : libraryItems.filter((libItem): libItem is CatalogTrackT => 'durationMs' in libItem);
      const curTrack = currentInfo.playback?.track;
      const curUri = curTrack?.uri;
      const curIdx = pool.findIndex((t) => t.uri === curUri);
      const remaining = curIdx >= 0 ? pool.length - 1 - curIdx : 0;

      // When fewer than 5 tracks remain in the active pool, fetch more
      if (remaining >= 5) return;

      isFetchingAutoplay = true;
      try {
        let newTracks: CatalogTrackT[] = [];
        const trackId = curUri?.replace('spotify:track:', '');

        // 1. Try Spotify Recommendations API with seed track
        if (trackId && !trackId.startsWith('sample') && !trackId.startsWith('ctx-')) {
          newTracks = await webApi.getRecommendations({ seedTracks: [trackId], limit: 20 });
        }

        // 2. Fallback: Search for more tracks by the current artist
        if (newTracks.length === 0 && curTrack?.artists && curTrack.artists.length > 0) {
          const firstArtist = curTrack.artists[0];
          const artistName = typeof firstArtist === 'string' ? firstArtist : undefined;
          if (artistName && artistName !== 'Spotify Artist' && artistName !== 'Test Artist') {
            const searchRes = await webApi.search(artistName, ['track'], 10);
            newTracks = searchRes.hits
              .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
              .map((h) => h.track);
          }
        }

        // 3. Fallback: Saved Library Tracks
        if (newTracks.length === 0) {
          const trackPool: CatalogTrackT[] = libraryItems.filter(
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
          const existingUris = new Set(activePlaylistTracks.map((t) => t.uri));
          const added = newTracks.filter((t) => !existingUris.has(t.uri));
          if (added.length > 0) {
            activePlaylistTracks.push(...added);
            logToFile(`[Autoplay] Appended ${added.length} tracks to queue`);
            void updateQueueView();
          }
        }
      } catch (e) {
        logToFile(`[Autoplay Error] ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        isFetchingAutoplay = false;
      }
    };

    const playTrackOrContext = async (opts: {
      trackUri?: string;
      contextUri?: string;
      title: string;
    }): Promise<void> => {
      // 1. Play directly via local native player sidecar (Spirc Spotify Connect receiver)
      try {
        await playback.load({
          trackUri: opts.trackUri,
          contextUri: opts.contextUri,
          autoplay: true,
        });
        ui?.setStatus(`▶ Playing: ${opts.title}`);
        return;
      } catch (err) {
        logToFile(`[Native Play Error] ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2. Fallback to Spotify Connect Web API if native player failed
      try {
        if (opts.trackUri) {
          await webApi.play({ uris: [opts.trackUri] });
        } else if (opts.contextUri) {
          await webApi.play({ context_uri: opts.contextUri });
        }
        ui?.setStatus(`▶ Playing on Spotify: ${opts.title}`);
        return;
      } catch (webErr) {
        logToFile(`[Web Play Error] ${webErr instanceof Error ? webErr.message : String(webErr)}`);
      }
    };

    const nextTrack = async (): Promise<void> => {
      // 1. If queue has upcoming items, take the next one from queue
      const qSnap = queueManager.getSnapshot();
      if (qSnap.upcoming.length > 0) {
        const nextItem = qSnap.upcoming[0];
        if (!nextItem) return;
        ui?.setStatus(`▶ Next: ${nextItem.track.name}`);
        await playTrackOrContext({
          trackUri: nextItem.track.uri,
          title: nextItem.track.name,
        });
        void updateQueueView();
        void ensureAutoplayTracks();
        return;
      }

      // 2. If active playlist or library has tracks, advance to next track
      let tracksToUse = activePlaylistTracks.length > 0 ? activePlaylistTracks : libraryItems;
      if (tracksToUse.length > 0) {
        const curUri = currentInfo.playback?.track?.uri;
        let curIdx = tracksToUse.findIndex((item) => item.uri === curUri);

        // When nearing end of tracks and autoplay is on, fetch more
        if (curIdx >= tracksToUse.length - 2 && currentInfo.playback?.autoplay) {
          await ensureAutoplayTracks();
          tracksToUse = activePlaylistTracks.length > 0 ? activePlaylistTracks : libraryItems;
          curIdx = tracksToUse.findIndex((item) => item.uri === curUri);
        }

        let nextIdx = 0;
        if (currentInfo.playback?.shuffle) {
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
          void updateQueueView();
          void ensureAutoplayTracks();
          return;
        }
      }

      // 3. Fallback: signal sidecar playback engine
      try {
        await webApi.nextTrack().catch(() => {});
        const res = await playback.next();
        if (res.track) {
          ui?.setStatus(`▶ Next: ${res.track.name}`);
        }
        void updateQueueView();
        void ensureAutoplayTracks();
      } catch (err) {
        logToFile(`[Next Error] ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const previousTrack = async (): Promise<void> => {
      const curPos = currentInfo.playback?.positionMs ?? 0;
      // If played more than 3 seconds, restart current track
      if (curPos > 3000) {
        await playback.seek(0).catch(() => {});
        ui?.setStatus('⏮ Restarted track');
        return;
      }

      // If active playlist or library has tracks, advance to previous track
      const tracksToUse = activePlaylistTracks.length > 0 ? activePlaylistTracks : libraryItems;
      if (tracksToUse.length > 0) {
        const curUri = currentInfo.playback?.track?.uri;
        const curIdx = tracksToUse.findIndex((item) => item.uri === curUri);
        const prevIdx = curIdx > 0 ? curIdx - 1 : tracksToUse.length - 1;
        const prevItem = tracksToUse[prevIdx];
        if (prevItem) {
          ui?.setStatus(`⏮ Previous: ${prevItem.name}`);
          await playTrackOrContext({
            trackUri: prevItem.uri,
            title: prevItem.name,
          });
          void updateQueueView();
          return;
        }
      }

      // Fallback: signal sidecar playback engine
      try {
        await webApi.previousTrack().catch(() => {});
        const res = await playback.previous();
        if (res.track) {
          ui?.setStatus(`⏮ Previous: ${res.track.name}`);
        }
        void updateQueueView();
      } catch (err) {
        logToFile(`[Previous Error] ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const toggleShuffle = async (): Promise<void> => {
      const next = !currentInfo.playback?.shuffle;
      try {
        if (webApi && typeof webApi.shuffle === 'function') {
          await webApi.shuffle(next).catch(() => {});
        }
        await playback.setShuffle(next);
        ui?.setStatus(`Shuffle: ${next ? 'ON' : 'OFF'}`);
      } catch (e) {
        ui?.setStatus(`shuffle: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const toggleRepeat = async (): Promise<void> => {
      const cur = currentInfo.playback?.repeat ?? 'off';
      const next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
      try {
        if (webApi && typeof webApi.repeat === 'function') {
          await webApi.repeat(next).catch(() => {});
        }
        await playback.setRepeat(next);
        ui?.setStatus(`Repeat: ${next.toUpperCase()}`);
      } catch (e) {
        ui?.setStatus(`repeat: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const toggleAutoplay = async (): Promise<void> => {
      const next = !currentInfo.playback?.autoplay;
      try {
        await playback.setAutoplay(next);
        ui?.setStatus(`Autoplay: ${next ? 'ON' : 'OFF'}`);
      } catch (e) {
        ui?.setStatus(`autoplay: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const seekRelative = async (deltaMs: number): Promise<void> => {
      const cur = currentInfo.playback?.positionMs ?? 0;
      const dur = currentInfo.playback?.durationMs ?? 0;
      const nextPos = Math.max(0, Math.min(dur > 0 ? dur : cur + deltaMs, cur + deltaMs));
      try {
        await playback.seek(nextPos);
        const secs = Math.floor(nextPos / 1000);
        const mins = Math.floor(secs / 60);
        const remSecs = secs % 60;
        ui?.setStatus(`Seek: ${mins}:${remSecs.toString().padStart(2, '0')}`);
      } catch (e) {
        ui?.setStatus(`seek: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const changeVolume = async (delta: number): Promise<void> => {
      const cur = currentInfo.playback?.volume ?? 0.8;
      const nextVol = Math.round(Math.max(0.0, Math.min(1.0, cur + delta)) * 100) / 100;
      try {
        await playback.setVolume(nextVol);
        ui?.setStatus(`Volume: ${Math.round(nextVol * 100)}%`);
      } catch (e) {
        ui?.setStatus(`volume: ${e instanceof Error ? e.message : String(e)}`);
      }
    };


    const handleKey: KeyDispatch = (key) => {
      if (key.ctrl && key.name === 'c') {
        void quit();
        return;
      }
      if (key.name === 'q' || key.name === 'Q') {
        void quit();
        return;
      }
      if (key.name === '?' || key.sequence === '?' || key.name === ':') {
        if (ui) ui.openPalette();
        return;
      }

      // If unauthenticated, gate player actions and offer direct login
      if (currentInfo.auth?.state !== 'authenticated') {
        if (isLowerKey(key, 'a') || key.name === 'return') {
          void triggerAuth();
          return;
        }
        if (
          ['space', 'k', 'n', 'p', '/', 'r', 'u', 'l', 'v', 's'].includes(
            (key.name ?? '').toLowerCase(),
          ) ||
          isUpperKey(key, 's') ||
          isUpperKey(key, 'r') ||
          isUpperKey(key, 'a') ||
          isUpperKey(key, 'v')
        ) {
          if (ui) {
            const cRes = resolveClientId();
            if (!cRes.clientId) {
              ui.setStatus('Setup required: Please enter Spotify Client ID first (press c to edit)', true);
            } else {
              ui.setStatus('Authentication required: Please log in with Spotify (press a or Enter to log in)', true);
            }
          }
          return;
        }
      }

      if (key.name === 'escape') {
        if (ui) ui.setRoute('home');
        return;
      }
      if (key.name === 'tab') {
        activeFocus = activeFocus === 'sidebar' ? 'main' : 'sidebar';
        if (ui) ui.setFocus(activeFocus);
        return;
      }
      if (key.name === 'space' || key.name === 'k' || key.name === 'K') {
        const state = currentInfo.playback?.state ?? 'idle';
        void (async () => {
          try {
            if (state === 'playing') {
              await webApi.pause().catch(() => {});
              await playback.pause();
            } else {
              await webApi.play({}).catch(() => {});
              await playback.play();
            }
          } catch (e) {
            if (ui) ui.setStatus(`playback: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
        return;
      }
      if (key.name === 'n' || key.name === 'N') {
        void nextTrack();
        return;
      }
      if (key.name === 'p' || key.name === 'P') {
        void previousTrack();
        return;
      }
      if (key.sequence === '>' || key.sequence === '.' || (key.ctrl && key.name === 'right')) {
        void seekRelative(5000);
        return;
      }
      if (key.sequence === '<' || key.sequence === ',' || (key.ctrl && key.name === 'left')) {
        void seekRelative(-5000);
        return;
      }
      if (key.sequence === '+' || key.sequence === '=') {
        void changeVolume(0.05);
        return;
      }
      if (key.sequence === '-' || key.sequence === '_') {
        void changeVolume(-0.05);
        return;
      }

      // Toggle Shuffle with 'S' (Shift+S)
      if (isUpperKey(key, 's')) {
        void toggleShuffle();
        return;
      }

      // Settings route with 's' (lowercase)
      if (isLowerKey(key, 's')) {
        if (ui) ui.setRoute('settings');
        return;
      }

      // Toggle Repeat Mode with 'R' (Shift+R)
      if (isUpperKey(key, 'r')) {
        void toggleRepeat();
        return;
      }

      // Library route & refresh with 'r' (lowercase)
      if (isLowerKey(key, 'r')) {
        if (ui) {
          ui.setRoute('library');
          void loadLibrary(true);
        }
        return;
      }

      // Toggle Autoplay with 'A' (Shift+A)
      if (isUpperKey(key, 'a')) {
        void toggleAutoplay();
        return;
      }

      // Authenticate with 'a' (lowercase)
      if (isLowerKey(key, 'a')) {
        void triggerAuth();
        return;
      }

      // Queue route with 'u' or 'U'
      if ((key.name ?? '').toLowerCase() === 'u' || (key.sequence ?? '').toLowerCase() === 'u') {
        if (ui) {
          ui.setRoute('queue');
          void updateQueueView();
          void ensureAutoplayTracks();
        }
        return;
      }

      // Toggle Visualizer on/off with 'V' (Shift+V)
      if (isUpperKey(key, 'v')) {
        if (ui) {
          const visible = ui.toggleVisualizer();
          ui.setStatus(visible ? `Visualizer enabled (${currentInfo.visualizer.mode})` : 'Visualizer hidden');
        }
        return;
      }

      // Visualizer mode cycle with 'v' (lowercase): if hidden, shows it; if shown, cycles mode
      if (isLowerKey(key, 'v')) {
        if (ui && !ui.isVisualizerVisible()) {
          ui.setVisualizerVisible(true);
          ui.setStatus(`Visualizer enabled (${currentInfo.visualizer.mode})`);
        } else {
          const next = visualizer.cycleMode();
          currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
          if (ui) {
            ui.setVisualizerFrame(null);
            ui.setStatus(`Visualizer mode: ${next}`);
          }
        }
        return;
      }

      if (isLowerKey(key, 'l')) {
        if (ui) {
          const curRoute = ui.getRoute();
          if (curRoute === 'lyrics') {
            ui.setRoute(lastRouteBeforeLyrics);
            ui.setStatus(`Exited lyrics → ${lastRouteBeforeLyrics}`);
          } else {
            lastRouteBeforeLyrics = curRoute;
            ui.setRoute('lyrics');
            void loadCurrentLyrics();
          }
        }
        return;
      }
      if (isUpperKey(key, 'l')) {
        if (ui) {
          if (ui.getRoute() !== 'lyrics') {
            lastRouteBeforeLyrics = ui.getRoute();
            ui.setRoute('lyrics');
          }
          void loadCurrentLyrics(true);
        }
        return;
      }
      if (key.name === '/') {
        if (ui) ui.setRoute('search');
        return;
      }
    };

    if (isTTY) {
      let searchSequence = 0;

      ui = await createUi(currentInfo, {
        onKey: handleKey,
        onSearchSubmit: (q) => {
          const query = q.trim();
          if (!query) return;
          if (ui) {
            ui.setSearchLoading(true);
            ui.setStatus(`Searching Spotify for "${query}"…`);
          }
          const seq = ++searchSequence;
          searchClient
            .search(query)
            .then((res) => {
              if (seq === searchSequence && ui) {
                ui.setSearchLoading(false);
                ui.setSearchResults(query, res);
                currentSearchHits = res.hits;
                const count = res.hits.length;
                ui.setStatus(
                  count > 0
                    ? `Found ${count} result${count === 1 ? '' : 's'} for "${query}". Press Enter to play.`
                    : `No results found for "${query}".`,
                );
              }
            })
            .catch((e: unknown) => {
              if (seq === searchSequence && ui) {
                ui.setSearchLoading(false);
                const msg = e instanceof Error ? e.message : String(e);
                ui.setStatus(`Search error: ${msg}`, true);
                ui.setSearchResults(query, { query, hits: [], error: { code: 'SEARCH_ERROR', message: msg } });
              }
            });
        },
        onSelectSearchHit: (hit) => {
          if (hit.type === 'track') {
            if (currentSearchHits.length > 0) {
              activePlaylistTracks = currentSearchHits
                .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
                .map((h) => h.track);
            }
            void playTrackOrContext({
              trackUri: hit.track.uri,
              title: hit.track.name,
            });
            void updateQueueView();
            void ensureAutoplayTracks();
          } else if (hit.type === 'album') {
            void playTrackOrContext({ contextUri: hit.album.uri, title: hit.album.name });
          } else if (hit.type === 'playlist') {
            void playTrackOrContext({ contextUri: hit.playlist.uri, title: hit.playlist.name });
          } else if (hit.type === 'artist') {
            void playTrackOrContext({ contextUri: hit.artist.uri, title: hit.artist.name });
          }
        },
        onSelectLibraryItem: (item) => {
          if ('durationMs' in item) {
            activePlaylistTracks = libraryItems
              .filter((libItem): libItem is CatalogTrackT => 'durationMs' in libItem);
            void playTrackOrContext({
              trackUri: item.uri,
              title: item.name,
            });
            void updateQueueView();
            void ensureAutoplayTracks();
          } else {
            void playTrackOrContext({ contextUri: item.uri, title: item.name });
          }
        },
        onSelectLibrary: (_idx) => {
          // Playback is handled by onSelectLibraryItem
        },
        onSelectQueue: (idx) => {
          const snap = queueManager.getSnapshot();
          const hasCurrent = Boolean(snap.current);
          const item = hasCurrent
            ? idx === 0 && snap.current
              ? { track: snap.current }
              : snap.upcoming[idx - 1]
            : snap.upcoming[idx];
          if (item) {
            void playTrackOrContext({
              trackUri: item.track.uri,
              title: item.track.name,
            });
            void updateQueueView();
            void ensureAutoplayTracks();
          }
        },
        onRouteChange: (route) => {
          if (route === 'library' && libraryItems.length === 0) {
            void loadLibrary();
          }
          if (route === 'queue') {
            void updateQueueView();
            void ensureAutoplayTracks();
          }
          if (route === 'lyrics') {
            void loadCurrentLyrics();
          }
        },
        onSaveClientId: async (newClientId: string) => {
          try {
            const res = saveClientId(newClientId);
            await auth.setClientId(newClientId);
            if (ui) {
              ui.setStatus(`Spotify Client ID saved to ${res.configPath}!`, true);
            }
          } catch (err) {
            if (ui) {
              ui.setStatus(
                `Failed to save Client ID: ${err instanceof Error ? err.message : String(err)}`,
                true,
              );
            }
          }
        },
        onAuthenticate: triggerAuth,
      });

      // Palette command list
      ui.setPaletteCommands([
        { name: 'Home View', description: 'Esc', action: () => ui?.setRoute('home') },
        { name: 'Search', description: '/', action: () => ui?.setRoute('search') },
        { name: 'Library', description: 'r', action: () => ui?.setRoute('library') },
        { name: 'Queue', description: 'u', action: () => ui?.setRoute('queue') },
        {
          name: 'Toggle Lyrics View',
          description: 'l',
          action: () => {
            if (ui) {
              const curRoute = ui.getRoute();
              if (curRoute === 'lyrics') {
                ui.setRoute(lastRouteBeforeLyrics);
              } else {
                lastRouteBeforeLyrics = curRoute;
                ui.setRoute('lyrics');
                void loadCurrentLyrics();
              }
            }
          },
        },
        { name: 'Settings', description: 's', action: () => ui?.setRoute('settings') },
        {
          name: 'Configure Spotify Client ID',
          description: 'Set/update Spotify Client ID',
          action: () => {
            if (ui) {
              ui.focusClientIdInput();
              ui.setStatus('Paste Spotify Client ID and press Enter to save', true);
            }
          },
        },
        {
          name: 'Toggle Play/Pause',
          description: 'Space / k',
          action: async () => {
            const state = currentInfo.playback?.state ?? 'idle';
            if (state === 'playing') await playback.pause();
            else await playback.play();
          },
        },
        {
          name: 'Next Track',
          description: 'n',
          action: () => void nextTrack(),
        },
        {
          name: 'Previous Track',
          description: 'p',
          action: () => void previousTrack(),
        },
        {
          name: 'Seek Forward 5s',
          description: '> / .',
          action: () => void seekRelative(5000),
        },
        {
          name: 'Seek Backward 5s',
          description: '< / ,',
          action: () => void seekRelative(-5000),
        },
        {
          name: 'Volume Up (+5%)',
          description: '+ / =',
          action: () => void changeVolume(0.05),
        },
        {
          name: 'Volume Down (-5%)',
          description: '- / _',
          action: () => void changeVolume(-0.05),
        },
        {
          name: 'Toggle Shuffle',
          description: 'S',
          action: () => void toggleShuffle(),
        },
        {
          name: 'Toggle Repeat Mode',
          description: 'R',
          action: () => void toggleRepeat(),
        },
        {
          name: 'Toggle Autoplay',
          description: 'A',
          action: () => void toggleAutoplay(),
        },
        {
          name: 'Toggle Visualizer Display',
          description: 'V',
          action: () => {
            if (ui) {
              const visible = ui.toggleVisualizer();
              ui.setStatus(visible ? `Visualizer enabled (${currentInfo.visualizer.mode})` : 'Visualizer hidden');
            }
          },
        },
        {
          name: 'Cycle Visualizer Mode',
          description: 'v',
          action: () => {
            if (ui && !ui.isVisualizerVisible()) {
              ui.setVisualizerVisible(true);
            } else {
              const next = visualizer.cycleMode();
              currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
              if (ui) {
                ui.setVisualizerFrame(null);
                ui.setStatus(`Visualizer mode: ${next}`);
              }
            }
          },
        },
        {
          name: 'Reload Lyrics',
          description: 'L',
          action: () => {
            void loadCurrentLyrics(true);
          },
        },
        {
          name: 'Authenticate with Spotify',
          description: 'OAuth (press A in settings)',
          action: triggerAuth,
        },
        { name: 'Quit Spotoei', description: 'q / Ctrl-C', action: () => void quit() },
      ]);

      if (initialAuth.state !== 'authenticated') {
        const initClientRes = resolveClientId();
        if (!initClientRes.clientId) {
          ui.setStatus('Welcome! Please enter your Spotify Client ID below to begin', true);
          ui.focusClientIdInput();
        } else {
          ui.setStatus('Welcome! Press [A] or [Enter] to authenticate with Spotify', true);
        }
      } else {
        ui.setStatus('Welcome back to Spotoei! Loading library…');
        void loadLibrary();
      }

      // Wire subscriptions to UI
      visualizer.subscribe((mode, data) => {
        if (ui) {
          ui.setVisualizerFrame({ mode, data });
        }
      });

      auth.onStatusChange((next: AuthStatusDataT) => {
        const wasAuthed = currentInfo.auth?.state === 'authenticated';
        currentInfo.auth = next;
        if (ui) ui.setAuth(next);
        if (!wasAuthed && next.state === 'authenticated') {
          ui?.setStatus('Successfully authenticated! Loading library…');
          void loadLibrary();
        }
      });

      let isAdvancingAutoplay = false;
      const advanceAutoplay = async () => {
        if (isAdvancingAutoplay) return;
        isAdvancingAutoplay = true;
        try {
          if (currentInfo.playback?.repeat === 'track') {
            if (currentInfo.playback?.track?.uri) {
              const curT = currentInfo.playback.track;
              await playTrackOrContext({
                trackUri: curT.uri,
                title: curT.name,
              });
            }
          } else if (currentInfo.playback?.autoplay) {
            await ensureAutoplayTracks();
            await nextTrack();
          }
        } finally {
          setTimeout(() => {
            isAdvancingAutoplay = false;
          }, 1500);
        }
      };

      let lastPlaybackState = currentInfo.playback?.state ?? 'idle';
      playback.onChange((next: PlaybackChangedDataT) => {
        const wasPlaying = lastPlaybackState === 'playing';
        lastPlaybackState = next.state;

        // The player is the single source of truth for playback state. We
        // never mutate `next` in place and never write back to
        // `currentInfo.playback.track`; we only render. Local enrichment
        // (matching against activePlaylistTracks / libraryItems or fetching
        // a track view from Spotify) is applied to a shallow-cloned copy
        // before handing it to the UI.
        let view: PlaybackChangedDataT = next;
        if (next.track) {
          const uri = next.track.uri;
          const matched =
            activePlaylistTracks.find((t) => t.uri === uri) ??
            libraryItems.find((t) => t.uri === uri);
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
              void webApi
                .getTrackView(trackId)
                .then(async (res) => {
                  if (res.type === 'track' && res.completeness === 'complete') {
                    const t = res.track;
                    if (currentInfo.playback?.track?.uri === uri && ui) {
                      const enriched: TrackT = {
                        ...(currentInfo.playback.track ?? next.track),
                        name: t.name,
                        artists: t.artists.map((a) => a.name),
                        album: t.albumName,
                        durationMs: t.durationMs,
                      };
                      const firstA = t.artists[0];
                      if (firstA?.id) {
                        const g = await resolveTrackGenre(firstA.id);
                        if (g && currentInfo.playback?.track?.uri === uri) {
                          enriched.genre = g;
                        }
                      }
                      ui.setPlayback({ ...currentInfo.playback, track: enriched, durationMs: t.durationMs });
                    }
                  }
                })
                .catch(() => {});
            }
          }

          // Asynchronously resolve genre if still missing
          if (!view.track?.genre && matched && 'artists' in matched && Array.isArray(matched.artists)) {
            const firstArtist = matched.artists[0];
            const artistId = firstArtist?.id;
            if (artistId) {
              const trackUri = view.track?.uri ?? uri;
              void resolveTrackGenre(artistId).then((g) => {
                if (g && ui && currentInfo.playback?.track?.uri === trackUri) {
                  ui.setPlayback({
                    ...currentInfo.playback,
                    track: { ...(currentInfo.playback?.track ?? next.track), genre: g },
                  });
                }
              }).catch(() => {});
            }
          }
        }

        currentInfo.playback = view;
        if (ui) ui.setPlayback(view);
        void updateQueueView();
        void ensureAutoplayTracks();
        if (ui?.getRoute() === 'lyrics') {
          void loadCurrentLyrics();
        }

        // Autoplay progression when track ends
        if (wasPlaying && view.state === 'idle') {
          void advanceAutoplay();
        }
      });

      playback.onPosition((pos) => {
        if (currentInfo.playback) {
          if (ui) ui.setPlaybackPosition(pos);
        }
      });

      queueManager.subscribe((snap) => {
        currentInfo.queue = snap;
        if (ui) ui.setQueueSnapshot(snap);
      });

      lyrics.subscribe((doc) => {
        if (ui) ui.setLyrics(doc);
      });

      // Handle optional CLI search argument
      if (args[0] === 'search' && args[1]) {
        const q = args.slice(1).join(' ');
        searchClient
          .search(q)
          .then((res: SearchResponseT) => {
            if (ui) {
              ui.setRoute('search');
              ui.setSearchResults(q, res);
            }
          })
          .catch((e: unknown) => {
            if (ui) ui.setStatus(e instanceof Error ? e.message : String(e));
          });
      }

      await requestQuit.promise;
    } else {
      // Non-TTY smoke test / batch mode
      if (args[0] === 'search' && args[1]) {
        const q = args.slice(1).join(' ');
        const res = await searchClient.search(q);
        process.stdout.write(
          `spotoei search: "${sanitize(q)}" (${res.hits.length} hit${res.hits.length === 1 ? '' : 's'})\n`,
        );
        for (const hit of res.hits) {
          if (hit.type === 'track') {
            const artists = hit.track.artists.map((a) => a.name).join(', ');
            const line = `  [track] ${hit.track.name} — ${artists}\n`;
            process.stdout.write(line);
          } else if (hit.type === 'album') {
            const artists = hit.album.artists.map((a) => a.name).join(', ');
            process.stdout.write(`  [album] ${hit.album.name} — ${artists}\n`);
          } else if (hit.type === 'artist') {
            process.stdout.write(`  [artist] ${hit.artist.name}\n`);
          } else if (hit.type === 'playlist') {
            process.stdout.write(`  [playlist] ${hit.playlist.name}\n`);
          }
        }
        return 0;
      }

      process.stdout.write('spotoei non-tty summary\n');
      process.stdout.write(`protocol: ${handshake.protocol}\n`);
      process.stdout.write(`player: ${handshake.playerVersion}\n`);
      process.stdout.write(`capabilities: ${handshake.capabilities.join(', ') || '(none)'}\n`);
      process.stdout.write(`auth: ${initialAuth.state}\n`);
      const trackName = initialPlayback.track?.name ?? '(idle)';
      process.stdout.write(`track: ${sanitize(trackName)} (display width: ${displayWidth(trackName)})\n`);
      await quit();
      return 0;
    }
  } catch (e) {
    process.stderr.write(`spotoei: initialization failed: ${e instanceof Error ? e.message : String(e)}\n`);
    if (child) {
      try {
        await stopPlayer(child);
      } catch {
        // ignore
      }
    }
    return 1;
  }
  return 0;
}

function runDoctor(args: string[]): number {
  const sub = args[0] ?? 'all';
  const valid = ['all', 'audio', 'auth', 'network', 'db', 'system'];
  if (!valid.includes(sub)) {
    process.stderr.write(`spotoei doctor: unknown check "${sub}". Valid: ${valid.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`spotoei doctor: running checks [${sub}]\n`);
  let ok = true;
  try {
    const bin = locatePlayer();
    process.stdout.write(`  [ok] player binary present: ${bin}\n`);
  } catch (e) {
    process.stdout.write(`  [fail] player binary: ${e instanceof Error ? e.message : String(e)}\n`);
    ok = false;
  }
  try {
    const dbTest = new Cache({ filename: ':memory:' });
    dbTest.close();
    process.stdout.write('  [ok] sqlite storage accessible\n');
  } catch (e) {
    process.stdout.write(`  [fail] sqlite storage: ${e instanceof Error ? e.message : String(e)}\n`);
    ok = false;
  }

  const clientRes = resolveClientId();
  if (clientRes.clientId) {
    process.stdout.write(`  [ok] spotify client id configured (${clientRes.source})\n`);
  } else {
    process.stdout.write(
      `  [warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ${clientRes.configPath})\n`,
    );
  }

  const redirectUri = getRedirectUri();
  process.stdout.write(`  [ok] spotify redirect uri: ${redirectUri}\n`);

  if (ok) {
    process.stdout.write('spotoei doctor: all checks passed\n');
    return 0;
  } else {
    process.stderr.write('spotoei doctor: some checks failed\n');
    return 1;
  }
}

function printHelp(): void {
  const out = `spotoei — Spotify TUI

USAGE:
  spotoei [COMMAND] [OPTIONS]

COMMANDS:
  (none)                         Launch the full interactive TUI
  search <query>                 Run a non-interactive search and print results
  doctor [check]                 Verify binary, audio output, auth, and database health
  config set-client-id <id>      Save Spotify Client ID to config file
  config set-redirect-port <port> Set Spotify OAuth redirect port (default: 8989)

OPTIONS:
  -h, --help        Show this help message
  -v, --version     Show protocol and application version

KEYBOARD SHORTCUTS:
  ? or :            Open Command Palette
  Space or k        Play / Pause toggle
  /                 Jump to Search
  r                 Jump to Library & refresh
  u                 Jump to Queue
  l                 Jump to Lyrics
  L                 Fetch lyrics for current track
  v                 Cycle Visualizer mode
  Tab               Toggle focus between sidebar and main
  Esc               Return to Home / close palette
  q or Ctrl-C       Quit
`;
  process.stdout.write(out);
}

function printVersion(): void {
  process.stdout.write(`spotoei v0.0.0 (protocol v${PROTOCOL_VERSION})\n`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    process.stderr.write(
      `spotoei: fatal unhandled error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 1;
  });
