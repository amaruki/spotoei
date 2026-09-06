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
import { locatePlayer, startPlayer } from '../player';
import { diagnostic, reportFailure } from '../diagnostics';
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
import { recoverSessions, RESTART_SESSION } from './recovery';
import { cancelHomeLoad } from './homeLoad';

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  return recoverSessions(() => runSession(args));
}

async function runSession(args: string[]): Promise<number> {
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

  const requestQuit = createRequestQuit<number>();
  let child: ChildProcess | null = null;
  let ui: Ui | null = null;
  let isQuitting = false;
  let restartRequested = false;
  let stage = 'player.locate';
  const cleanup: Array<() => void> = [];
  const quit = createShutdownFn(
    () => ui,
    () => child,
    requestQuit,
  );
  const quitWithFlag = async () => {
    isQuitting = true;
    if (ctx.state) cancelHomeLoad(ctx.state);
    await quit();
  };
  void requestQuit.promise.then(() => {
    isQuitting = true;
  });
  const ctx: AppContext = {
    quit: quitWithFlag,
    child: null as unknown as ChildProcess,
    clients: null as unknown as AppClients,
    state: null as unknown as AppState,
    getUi: () => ui,
  };
  const removeSignals = installSignalHandlers(quitWithFlag);
  const removeUncaught = installUncaughtHandler(
    () => ui,
    () => child,
  );
  try {
    const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const playerBin = locatePlayer();
    diagnostic('runtime', 'startup', { binary: playerBin, tty: isTTY, bun: Bun.version });
    const clientRes = resolveClientId();
    const extraEnv: Record<string, string> = {};
    if (clientRes.clientId) extraEnv.SPOTOEI_CLIENT_ID = clientRes.clientId;
    stage = 'player.handshake';
    const handshake = await startPlayer(playerBin, extraEnv);
    child = handshake.child;
    ctx.child = handshake.child;
    const onPlayerExit = async (code: number | null) => {
      if (isQuitting) return;
      diagnostic('sidecar', 'exit', { playerPid: child?.pid, code });
      restartRequested = true;
      await quitWithFlag();
    };
    child.on('exit', onPlayerExit);

    const auth = createAuthClient({ child });
    const playback = createPlaybackClient({ child });
    cleanup.push(
      () => auth.close(),
      () => playback.close(),
    );
    stage = 'auth.status';
    const initialAuth = await auth.status();
    diagnostic('ipc', 'auth.status', { state: initialAuth.state, scopes: initialAuth.scopes });
    stage = 'playback.status';
    const initialPlayback = await playback.status();

    const cache = new Cache();
    cleanup.push(() => cache.close());
    const tokenProvider = {
      async getAccessToken(): Promise<string> {
        return auth.getWebToken();
      },
      invalidateToken(): void {
        auth.clearToken();
      },
    };
    const webApi = new WebApiClient({
      tokenProvider,
      restrictionStore: {
        // Restriction memory persists in SQLite so a cold start skips
        // endpoints Spotify already refused, instead of re-probing them.
        // getQuery prunes expired rows on read; failures fall back to
        // the Transport's in-memory map.
        getRestriction: (endpoint: string): number | undefined => {
          try {
            const cached = cache.getQuery<number>(
              initialAuth.accountId ?? 'anonymous',
              `restriction:v1:${endpoint}`,
            );
            if (!cached || cached.expiresAt === null || Date.now() >= cached.expiresAt) {
              return undefined;
            }
            return cached.expiresAt;
          } catch {
            return undefined;
          }
        },
        setRestriction: (endpoint: string, until: number): void => {
          try {
            cache.putQuery(
              initialAuth.accountId ?? 'anonymous',
              `restriction:v1:${endpoint}`,
              1,
              until - Date.now(),
            );
          } catch {
            // Non-fatal; the in-memory map still suppresses repeats.
          }
        },
      },
    });
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
    cleanup.push(
      () => searchClient.close(),
      () => visualizer.stop(),
      () => lyrics.close(),
    );

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
      audioConfig: {
        deviceMode: 'integrated',
        audioBackend: 'rodio',
        bitrate: '320',
        crossfadeDurationMs: 0,
        normalisation: true,
        pregain: 0,
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
            playRadio: playbackActions.playRadio,
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
      stage = 'ui.mount';
      ui = await initUi(ctx, {
        ...authActions,
        ...libraryActions,
        ...lyricsActions,
        ...queueActions,
        ...playbackActions,
        handleKey,
      });

      void playback
        .getAudioConfig()
        .then((cfg) => {
          currentInfo.audioConfig = { ...currentInfo.audioConfig, ...cfg };
          ui?.setAudioConfig(cfg);
        })
        .catch(() => {});

      if (initialAuth.state !== 'authenticated') {
        const initClientRes = resolveClientId();
        if (!initClientRes.clientId) {
          ui.setStatus('Welcome! Please enter your Spotify Client ID below to begin', true);
          ui.focusClientIdInput();
        } else {
          ui.setStatus('Welcome! Press [a] or [Enter] to authenticate with Spotify', true);
        }
      } else {
        void clients.webApi
          ?.getDevices?.()
          .then((devices) => {
            const spotoei = devices?.find((d) => d.name.toLowerCase().includes('spotoei'));
            if (spotoei && !spotoei.is_active) {
              void clients.webApi?.transferPlayback?.(spotoei.id, false).catch(() => {});
            }
          })
          .catch(() => {});
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
    const id = reportFailure(stage === 'ui.mount' ? 'ui' : 'runtime', stage, e);
    await quitWithFlag();
    process.stderr.write(
      `spotoei: initialization failed at ${stage} [${id}]. See the diagnostic log.\n`,
    );
    return restartRequested ? RESTART_SESSION : 1;
  } finally {
    await quitWithFlag();
    ui = null;
    for (const close of cleanup.toReversed()) close();
    removeSignals();
    removeUncaught();
  }
  return restartRequested ? RESTART_SESSION : 0;
}
