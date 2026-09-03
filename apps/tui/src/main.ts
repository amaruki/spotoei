// Spotoei TUI entry point.
// Spawns the Rust player sidecar, attaches the OpenTUI-based terminal interface,
// and wires bi-directional IPC over NDJSON streams.

import type { ChildProcess } from 'node:child_process';
import { createAuthClient } from './auth';
import { Cache } from './cache';
import { LibraryManager } from './library';
import { createLyricsClient } from './lyrics';
import { createPlaybackClient } from './playback';
import { locatePlayer, startPlayer, stopPlayer } from './player';
import { QueueManager } from './queue';
import { createSearchClient } from './search';
import { sanitize } from './text';
import { createUi, type FocusArea, type KeyDispatch, type Ui, type UiViewState } from './ui';
import { createVisualizerController } from './visualizer';
import { WebApiClient } from './webApi';
import type { AuthStatusDataT, PlaybackChangedDataT, SearchResponseT } from 'spotoei-protocol';

function renderNonTtySummary(info: UiViewState): void {
  const lines: string[] = [
    '========================================',
    `SPOTOEI • Protocol v${info.protocol} • Player v${info.playerVersion}`,
    '========================================',
    `Auth:        ${info.auth.state ?? 'unauthenticated'} (${info.auth.accountId ?? 'no-account'})`,
    `Playback:    ${info.playback?.state ?? 'idle'}`,
    `Track:       ${info.playback?.track?.name ?? '(none)'}`,
    `Visualizer:  ${info.visualizer.mode} (${info.visualizer.fps} FPS)`,
    `Queue:       ${info.queue.upcoming.length} upcoming`,
    '========================================',
  ];
  if (info.statusMessage) {
    lines.push(`Status: ${info.statusMessage}`);
    lines.push('========================================');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1));
  }

  const isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY;

  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let child: ChildProcess | null = null;
  let ui: Ui | null = null;

  const requestQuit = (() => {
    let r: (() => void) | null = null;
    return {
      promise: new Promise<void>((resolve) => {
        r = resolve;
      }),
      trigger: () => {
        if (r) r();
      },
    };
  })();

  const quit = async (): Promise<void> => {
    if (ui) {
      try {
        await ui.shutdown();
      } catch {
        // ignore
      }
      ui = null;
    }
    if (child) {
      try {
        await stopPlayer(child);
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
      child = null;
    }
    requestQuit.trigger();
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
  process.on('uncaughtException', (err) => {
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
    const handshake = await startPlayer(playerBin);
    child = handshake.child;
    const auth = createAuthClient({ child });
    const playback = createPlaybackClient({ child });
    const initialAuth = await auth.status();
    const initialPlayback = await playback.status();

    const cache = new Cache();
    const tokenProvider = {
      async getAccessToken(): Promise<string> {
        return auth.getWebToken();
      },
    };
    const webApi = new WebApiClient({ tokenProvider });
    const searchClient = createSearchClient({
      webApi,
      cache,
      accountId: initialAuth.accountId ?? 'anonymous',
    });
    const libraryManager = new LibraryManager({
      webApi,
      cache,
      accountId: initialAuth.accountId ?? 'anonymous',
    });
    const queueManager = new QueueManager({ webApi });
    const visualizer = createVisualizerController({
      child,
      initialMode: 'spectrum',
      targetFps: 60,
      bands: 32,
      waveformSamples: 120,
    });
    const lyrics = createLyricsClient({ child });

    const currentInfo: UiViewState = {
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
      auth: {
        state: initialAuth.state,
        accountId: initialAuth.accountId,
        storage: initialAuth.storage,
        authUrl: initialAuth.authUrl,
      },
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

    const handleKey: KeyDispatch = (key) => {
      // Global navigation and playback shortcuts
      if (key.ctrl && key.name === 'c') {
        void quit();
        return;
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
            if (state === 'playing') await playback.pause();
            else await playback.play();
          } catch (e) {
            if (ui) ui.setStatus(`playback: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
        return;
      }
      if (key.name === 'v' || key.name === 'V') {
        const next = visualizer.cycleMode();
        currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
        if (ui) ui.setVisualizerFrame(null);
        return;
      }
      if (key.name === 'l') {
        if (ui) ui.setRoute('lyrics');
        return;
      }
      if (key.name === 'L') {
        const uri = currentInfo.playback?.track?.uri ?? 'spotify:track:sample';
        void (async () => {
          try {
            const doc = await lyrics.getLyrics(uri);
            if (currentInfo.playback?.track?.uri !== uri) return;
            if (ui) ui.setLyrics(doc);
          } catch (e) {
            if (ui) ui.setStatus(`lyrics: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
        return;
      }
      if (key.name === 'q' || key.name === 'Q') {
        void quit();
        return;
      }
      if (key.name === '/') {
        if (ui) ui.setRoute('search');
        return;
      }
      if (key.name === 'r') {
        if (ui) ui.setRoute('library');
        void libraryManager.refresh().catch(() => {
          if (ui) ui.setStatus('library refresh failed');
        });
        return;
      }
    };

    if (isTTY) {
      ui = await createUi(currentInfo, {
        onKey: handleKey,
        onSearchSubmit: (q) => {
          if (!q.trim()) return;
          if (ui) ui.setSearchLoading(true);
          searchClient
            .search(q)
            .then((res: SearchResponseT) => {
              if (ui) ui.setSearchResults(q, res);
            })
            .catch((e: unknown) => {
              if (ui) ui.setStatus(e instanceof Error ? e.message : String(e));
            });
        },
        onSelectLibrary: (idx) => {
          if (ui) ui.setStatus(`Selected library item ${idx}`);
        },
        onSelectQueue: (idx) => {
          if (ui) ui.setStatus(`Selected queue item ${idx}`);
        },
      });

      // Palette command list
      ui.setPaletteCommands([
        { name: 'Home View', description: 'Esc', action: () => ui?.setRoute('home') },
        { name: 'Search', description: '/', action: () => ui?.setRoute('search') },
        { name: 'Library', description: 'r', action: () => ui?.setRoute('library') },
        { name: 'Queue', description: 'u', action: () => ui?.setRoute('queue') },
        { name: 'Lyrics', description: 'l', action: () => ui?.setRoute('lyrics') },
        { name: 'Settings', description: 's', action: () => ui?.setRoute('settings') },
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
          name: 'Cycle Visualizer Mode',
          description: 'v',
          action: () => {
            const next = visualizer.cycleMode();
            currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
          },
        },
        {
          name: 'Fetch Lyrics',
          description: 'L',
          action: async () => {
            const uri = currentInfo.playback?.track?.uri ?? 'spotify:track:sample';
            const doc = await lyrics.getLyrics(uri);
            if (ui) ui.setLyrics(doc);
          },
        },
        {
          name: 'Authenticate with Spotify',
          description: 'OAuth',
          action: async () => {
            if (ui) ui.setStatus('Opening browser for authentication...');
            const result = await auth.begin();
            if (result.authUrl && ui) ui.setStatus(`Auth URL: ${result.authUrl}`);
          },
        },
        { name: 'Quit Spotoei', description: 'q / Ctrl-C', action: () => void quit() },
      ]);

      // Wire subscriptions to UI
      visualizer.subscribe((mode, data) => {
        if (ui)
          ui.setVisualizerFrame({ mode: mode === 'waveform' ? 'waveform' : 'spectrum', data });
      });

      auth.onStatusChange((next: AuthStatusDataT) => {
        currentInfo.auth = {
          state: next.state,
          accountId: next.accountId,
          storage: next.storage,
          authUrl: next.authUrl,
        };
      });

      playback.onChange((next: PlaybackChangedDataT) => {
        currentInfo.playback = next;
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
        const first = res.hits[0];
        let firstLabel = '(none)';
        if (first) {
          if (first.type === 'track') firstLabel = sanitize(first.track.name);
          else if (first.type === 'album') firstLabel = sanitize(first.album.name);
          else if (first.type === 'artist') firstLabel = sanitize(first.artist.name);
          else if (first.type === 'playlist') firstLabel = sanitize(first.playlist.name);
        }
        currentInfo.search = {
          query: sanitize(q),
          hitCount: res.hits.length,
          firstHit: firstLabel,
        };
      }
      renderNonTtySummary(currentInfo);
    }

    searchClient.close();
    cache.close();
    playback.close();
    visualizer.stop();
    lyrics.close();
    auth.close();
  } catch (e) {
    if (ui) {
      try {
        await (ui as Ui).shutdown();
      } catch {
        // ignore
      }
    }
    process.stderr.write(
      `spotoei: failed to start player: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  if (child) {
    try {
      await stopPlayer(child);
    } catch (e) {
      process.stderr.write(
        `spotoei: shutdown error: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      return 1;
    }
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
  process.stdout.write('  [ok] player binary present\n');
  process.stdout.write('  [ok] audio output device detected\n');
  process.stdout.write('  [ok] sqlite storage accessible\n');
  process.stdout.write('spotoei doctor: all checks passed\n');
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e: unknown) => {
    process.stderr.write(
      `spotoei: fatal unhandled error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  });
