import { spawnSync } from 'node:child_process';
import { locatePlayer, startPlayer, stopPlayer } from './player';
import { createAuthClient } from './auth';
import { createPlaybackClient } from './playback';
import { Cache } from './cache';
import { WebApiClient } from './webApi';
import { createSearchClient } from './search';
import { LibraryManager } from './library';
import { QueueManager } from './queue';
import { createVisualizerController } from './visualizer';
import { createLyricsClient } from './lyrics';
import type {
  AuthStatusDataT,
  PlaybackChangedDataT,
  SearchResponseT,
  LyricsDocumentT,
} from 'spotoei-protocol';

function padBox(content: string, innerWidth = 40): string {
  const truncated =
    content.length > innerWidth ? content.slice(0, innerWidth) : content;
  return `│${truncated.padEnd(innerWidth, ' ')}│`;
}

function line(label: string, value: string): string {
  return padBox(`  ${label.padEnd(8)}${value}`);
}

function detail(label: string, value: string): string {
  return padBox(`  ${label.padEnd(8)}${value}`);
}

function renderShell(info?: {
  protocol: number;
  playerVersion: string;
  capabilities: string[];
  auth?: AuthStatusDataT;
  playback?: PlaybackChangedDataT | null;
  search?: {
    query: string;
    hitCount: number;
    firstHit?: string;
  };
  library?: {
    collection: string;
    total: number;
  };
  queue?: {
    upcomingCount: number;
  };
  visualizer?: {
    mode: string;
    fps: number;
  };
  lyrics?: {
    kind: string;
    lineCount: number;
  };
}) {
  const playerLine = info
    ? line('player', info.playerVersion)
    : line('player', '(spawning...)');
  const protoLine = info
    ? line('proto', `v${String(info.protocol)}`)
    : line('proto', '(pending...)');
  const caps = info
    ? info.capabilities.length
      ? info.capabilities.join(', ')
      : '(none)'
    : '(pending...)';

  const authLine = info?.auth
    ? line('auth', info.auth.state)
    : line('auth', '(pending...)');
  let authDetail: string;
  if (!info?.auth) {
    authDetail = detail('↳', '(awaiting handshake)');
  } else if (info.auth.state === 'authenticating' && info.auth.authUrl) {
    authDetail = detail('↳', `open in browser: ${info.auth.authUrl.slice(0, 22)}`);
  } else if (info.auth.state === 'authenticated' && info.auth.accountId) {
    authDetail = detail('↳', `account: ${info.auth.accountId.slice(0, 24)}`);
  } else if (info.auth.state === 'refresh-failed') {
    authDetail = detail('↳', 'reauth required');
  } else {
    authDetail = detail('↳', '');
  }

  const trackName = info?.playback?.track
    ? `${info.playback.track.name} - ${info.playback.track.artists.join(', ')}`
    : '(no track)';
  const playbackState = info?.playback
    ? `${info.playback.state} [vol:${Math.round(info.playback.volume * 100)}%]`
    : '(idle)';
  const playbackLine = line('play', playbackState);
  const trackLine = detail('↳ track', trackName);

  const searchLine = info?.search
    ? line('search', `"${info.search.query.slice(0, 18)}" (${info.search.hitCount})`)
    : line('search', '(idle)');
  const searchDetail = info?.search?.firstHit
    ? detail('↳ hit', info.search.firstHit)
    : detail('↳', '');

  const libraryLine = info?.library
    ? line('library', `${info.library.collection} (${info.library.total})`)
    : line('library', '(idle)');

  const queueLine = info?.queue
    ? line('queue', `${info.queue.upcomingCount} upcoming`)
    : line('queue', '(idle)');

  const vizLine = info?.visualizer
    ? line('viz', `${info.visualizer.mode} [${info.visualizer.fps}fps]`)
    : line('viz', '(idle)');

  const lyricsLine = info?.lyrics
    ? line('lyrics', `${info.lyrics.kind} (${info.lyrics.lineCount} lines)`)
    : line('lyrics', '(idle)');

  process.stdout.write(
    [
      '┌────────────────────────────────────────┐',
      '│  SPOTOEI  (Milestone 6)                │',
      '├────────────────────────────────────────┤',
      playerLine,
      protoLine,
      line('caps', caps),
      '├────────────────────────────────────────┤',
      authLine,
      authDetail,
      '├────────────────────────────────────────┤',
      playbackLine,
      trackLine,
      '├────────────────────────────────────────┤',
      searchLine,
      searchDetail,
      '├────────────────────────────────────────┤',
      libraryLine,
      queueLine,
      vizLine,
      lyricsLine,
      '└────────────────────────────────────────┘',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1));
  }

  // The client renders its shell BEFORE spawning the player child, ensuring
  // immediate visual feedback without waiting for child process startup.
  renderShell();

  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let child;
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
      bands: 64,
      waveformSamples: 120,
    });
    const lyrics = createLyricsClient({ child });
    const activeLyrics = new Map<string, LyricsDocumentT>();

    const currentInfo: {
      protocol: number;
      playerVersion: string;
      capabilities: string[];
      auth: AuthStatusDataT;
      playback: PlaybackChangedDataT | null;
      search?: {
        query: string;
        hitCount: number;
        firstHit?: string;
      };
      library?: {
        collection: string;
        total: number;
      };
      queue?: {
        upcomingCount: number;
      };
      visualizer?: {
        mode: string;
        fps: number;
      };
      lyrics?: {
        kind: string;
        lineCount: number;
      };
    } = {
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
      library: {
        collection: 'saved_tracks',
        total: 0,
      },
      queue: {
        upcomingCount: 0,
      },
      visualizer: {
        mode: visualizer.getMode(),
        fps: visualizer.getCurrentFps(),
      },
    };
    renderShell(currentInfo);

    visualizer.subscribe((mode) => {
      currentInfo.visualizer = {
        mode,
        fps: visualizer.getCurrentFps(),
      };
      // In full TUI, this draws frames; for smoke test, we update the shell
    });
    renderShell(currentInfo);

    auth.onStatusChange((next) => {
      currentInfo.auth = {
        state: next.state,
        accountId: next.accountId,
        storage: next.storage,
        authUrl: next.authUrl,
      };
      renderShell(currentInfo);
    });

    playback.onChange((next) => {
      currentInfo.playback = next;
      renderShell(currentInfo);
    });

    queueManager.subscribe((snap) => {
      currentInfo.queue = {
        upcomingCount: snap.upcoming.length,
      };
    });

    lyrics.subscribe((doc) => {
      currentInfo.lyrics = {
        kind: doc.kind,
        lineCount: doc.lines.length,
      };
      renderShell(currentInfo);
    });
    // Optional query argument for testing/smoke verification
    if (args[0] === 'search' && args[1]) {
      const q = args.slice(1).join(' ');
      const res: SearchResponseT = await searchClient.search(q);
      const first = res.hits[0];
      let firstLabel = '(none)';
      if (first) {
        if (first.type === 'track') firstLabel = first.track.name;
        else if (first.type === 'album') firstLabel = first.album.name;
        else if (first.type === 'artist') firstLabel = first.artist.name;
        else if (first.type === 'playlist') firstLabel = first.playlist.name;
      }
      currentInfo.search = {
        query: q,
        hitCount: res.hits.length,
        firstHit: firstLabel,
      };
      renderShell(currentInfo);
    }

    // Best-effort single-key listener: `v` cycles visualizer mode.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onKey = (chunk: string): void => {
        if (chunk === 'v' || chunk === 'V') {
          const next = visualizer.cycleMode();
          currentInfo.visualizer = {
            mode: next,
            fps: visualizer.getCurrentFps(),
          };
          renderShell(currentInfo);
        }
        if (chunk === 'l' || chunk === 'L') {
          const uri = currentInfo.playback?.track?.uri ?? 'spotify:track:sample';
          lyrics
            .getLyrics(uri)
            .then((doc) => {
              currentInfo.lyrics = {
                kind: doc.kind,
                lineCount: doc.lines.length,
              };
              renderShell(currentInfo);
            })
            .catch(() => {
              // Ignore lyrics retrieval failure in interactive mode
            });
        }
        if (chunk === 'q' || chunk === 'Q' || chunk === '\u0003') {
          process.stdin.removeListener('data', onKey);
        }
      };
      process.stdin.on('data', onKey);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    searchClient.close();
    cache.close();
    playback.close();
    visualizer.stop();
    lyrics.close();
    auth.close();
  } catch (e) {
    process.stderr.write(`spotoei: failed to start player: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  try {
    await stopPlayer(child);
  } catch (e) {
    process.stderr.write(`spotoei: shutdown error: ${e instanceof Error ? e.message : String(e)}\n`);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    return 1;
  }
  return 0;
}

function runDoctor(args: string[]): number {
  const sub = args[0] ?? 'all';
  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei doctor: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // Doctor runs directly against the player child binary to produce
  // detailed keyring and account reporting.
  const result = spawnSync(playerBin, ['doctor', sub], { stdio: 'inherit' });
  return result.status ?? 0;
}

const code = await main();
process.exit(code);
