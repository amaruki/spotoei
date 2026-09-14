import type { ChildProcess } from 'node:child_process';

import { resolveClientId } from '../config';
import { locatePlayer, startPlayer } from '../player';
import { diagnostic, reportFailure } from '../diagnostics';
import type { Ui } from '../ui';

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
import { runAuthenticate } from './authenticate';
import { createSessionClients } from './sessionClients';

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
  if (args[0] === 'authenticate') {
    return runAuthenticate();
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

    const session = await createSessionClients(child, handshake, cleanup, (next) => {
      stage = next;
    });
    ctx.clients = session.clients;
    ctx.state = session.state;
    ctx.setActiveAccountId = session.setActiveAccountId;
    const { clients, state, currentInfo, initialAuth, initialPlayback } = session;
    const playback = clients.playback;

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
        const initClientRes = resolveClientId(false);
        if (!initClientRes.clientId) {
          ui.setStatus(
            'Welcome! Please enter your Spotify Client ID below to begin (or [d] for default)',
            true,
          );
          ui.focusClientIdInput();
        } else {
          ui.setStatus('Welcome! Press [a] or [Enter] to authenticate with Spotify', true);
        }
      } else {
        void (async () => {
          const hasStreaming = await clients.auth.streamingStatus().catch(() => false);
          state.hasStreaming = hasStreaming;
          if (!hasStreaming) {
            state.currentInfo.streamingPending = true;
            if (ui) {
              ui.setStreamingPending(true);
              ui.setRoute('onboarding');
              ui.setStatus(
                'Web API connected. Opening Audio Streaming permission (Step 2/2)...',
                true,
              );
            }
            await authActions.triggerAuth({ streamingOnly: true });
          }
        })();
      }

      wireSubscriptions(
        ctx,
        {
          ...authActions,
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
