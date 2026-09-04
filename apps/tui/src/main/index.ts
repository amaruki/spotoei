import type { ChildProcess } from 'node:child_process';

import { createAuthClient } from '../auth';
import { Cache } from '../cache';
import { resolveClientId } from '../config';
import { EntityManager } from '../entities';
import { HomeManager } from '../home';
import { initialHomeTabs } from '../home/tabs';
import { createLyricsClient } from '../lyrics';
import { createPlaybackClient } from '../playback';
import { LibraryManager } from '../library';
import { locatePlayer, restartPlayer, startPlayer, stopPlayer } from '../player';
import { QueueManager } from '../queue';
import { createSearchClient } from '../search';
import type { Ui, UiViewState } from '../ui';
import { createVisualizerController } from '../visualizer';
import { WebApiClient } from '../webApi';

import { createAuthActions } from './auth';
import { handleCliSearch, runNonTtyMode } from './batch';
import { handleConfigSubcommand, printHelp, printVersion, runDoctor } from './cli';
import { createMenuOpener } from './contextMenuItems';
import { createEnrichment } from './enrich';
import { createKeyHandler } from './keys';
import {
  createRequestQuit,
  createShutdownFn,
  installSignalHandlers,
  installUncaughtHandler,
} from './lifecycle';
import { createLibraryActions } from './library';
import { wireSubscriptions } from './listeners';
import { createLyricsActions } from './lyrics';
import { createPlaybackActions } from './playback';
import { createQueueActions } from './queue';
import type { AppClients, AppContext, AppState } from './types';
import { initUi } from './ui';

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
  const configExit = handleConfigSubcommand(args);
  if (configExit !== null) {
    return configExit;
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

  const requestQuit = createRequestQuit<number>();
  let child: ChildProcess | null = null;
  let ui: Ui | null = null;
  let isQuitting = false;
  const quit = createShutdownFn(() => ui, () => child, requestQuit);
  const quitWithFlag = async () => { isQuitting = true; await quit(); };
  void requestQuit.promise.then(() => { isQuitting = true; });
  const ctx: AppContext = { quit: quitWithFlag, child: null as unknown as ChildProcess, clients: null as unknown as AppClients, state: null as unknown as AppState, getUi: () => ui };
  installSignalHandlers(quitWithFlag);
  installUncaughtHandler(() => ui, () => child);
  try {
    const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    let playerBin: string;
    try { playerBin = locatePlayer(); } catch (e) { process.stderr.write(`spotoei: ${e instanceof Error ? e.message : String(e)}\n`); return 1; }
    const clientRes = resolveClientId();
    const extraEnv: Record<string, string> = {};
    if (clientRes.clientId) extraEnv.SPOTOEI_CLIENT_ID = clientRes.clientId;
    const handshake = await startPlayer(playerBin, extraEnv);
    child = handshake.child; ctx.child = handshake.child;
    let restartTimestamps: number[] = [];
    const onPlayerExit = async (code: number | null) => {
      if (isQuitting) return;
      const now = Date.now(); restartTimestamps = restartTimestamps.filter((t) => now - t < 60000); restartTimestamps.push(now);
      if (restartTimestamps.length > 3) { try { ui?.setStatus('Player unavailable: restart limit exceeded (3/60s)', true); } catch { process.stderr.write('Player unavailable: restart limit exceeded (3/60s)\n'); } return; }
      try { ui?.setStatus(`Player exited (code ${code ?? 'none'}), restarting...`, true); } catch { process.stderr.write(`Player exited (code ${code ?? 'none'}), restarting...\n`); }
      try {
        const crashed = child; if (!crashed) return;
        const next = await restartPlayer(crashed, playerBin, extraEnv, restartTimestamps.length - 1);
        child = next.child; ctx.child = next.child; child.on('exit', onPlayerExit);
        try { ui?.setStatus('Player restarted', false); } catch { process.stderr.write('Player restarted\n'); }
      } catch (e) { const msg = e instanceof Error ? e.message : String(e); try { ui?.setStatus(`Player unavailable: ${msg}`, true); } catch { process.stderr.write(`Player unavailable: ${msg}\n`); } }
    };
    child.on('exit', onPlayerExit);

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
    const entityManager = new EntityManager(webApi, cache, initialAuth.accountId ?? 'anonymous');
    const homeManager = new HomeManager(webApi, cache, initialAuth.accountId ?? 'anonymous');
    const queueManager = new QueueManager({ webApi });
    const visualizer = createVisualizerController({ child });
    const lyrics = createLyricsClient({ child });

    const clients: AppClients = {
      auth,
      playback,
      webApi,
      searchClient,
      entityManager,
      homeManager,
      libraryManager,
      queueManager,
      visualizer,
      lyrics,
      cache,
    };

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

    const state: AppState = {
      currentInfo,
      activeFocus: 'main',
      libraryItems: [],
      librarySection: 'saved_tracks',
      entityPages: {},
      homeTabs: initialHomeTabs(),
      activePlaylistTracks: [],
      currentSearchHits: [],
      artistGenreCache: new Map(),
      currentLyricsTrackUri: undefined,
      lastRouteBeforeLyrics: { kind: 'home', tab: 'for_you' },
      searchSequence: 0,
      isFetchingAutoplay: false,
      isAdvancingAutoplay: false,
      lastPlaybackState: initialPlayback?.state ?? 'idle',
    };

    ctx.clients = clients;
    ctx.state = state;

    const authActions = createAuthActions(ctx);
    const libraryActions = createLibraryActions(ctx);
    const lyricsActions = createLyricsActions(ctx);
    const queueActions = createQueueActions(ctx);
    const playbackActions = createPlaybackActions(ctx);
    const enrichment = createEnrichment(ctx);
    const menuActions = {
      openContextMenuFor: createMenuOpener(
        {
          ...ctx,
          contextActions: {
            playTrackOrContext: playbackActions.playTrackOrContext,
            updateQueueView: queueActions.updateQueueView,
            ensureAutoplayTracks: queueActions.ensureAutoplayTracks,
          },
        },
        () => ui,
      ),
    };

    const handleKey = createKeyHandler(ctx, {
      ...authActions,
      ...libraryActions,
      ...lyricsActions,
      ...queueActions,
      ...playbackActions,
      ...menuActions,
    });

    if (isTTY) {
      ui = await initUi(ctx, {
        ...authActions,
        ...libraryActions,
        ...lyricsActions,
        ...queueActions,
        ...playbackActions,
        handleKey,
      });

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
        void libraryActions.loadLibrary();
      }

      wireSubscriptions(
        ctx,
        {
          ...libraryActions,
          ...lyricsActions,
          ...queueActions,
          ...playbackActions,
        },
        enrichment,
      );

      if (args[0] === 'search' && args[1]) {
        handleCliSearch(args.slice(1).join(' '), clients, ui);
      }

      await requestQuit.promise;
    } else {
      return await runNonTtyMode(ctx, args, handshake, initialAuth, initialPlayback, clients, ui);
    }
  } catch (e) {
    process.stderr.write(
      `spotoei: initialization failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
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
