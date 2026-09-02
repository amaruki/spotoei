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
import { getLayoutTier, drawBox, renderStatusBar, type LayoutTier } from './layout';
import { CommandPalette } from './palette';
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
      '│  SPOTOEI  (Milestone 8)                │',
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

type Route = 'home' | 'search' | 'library' | 'queue' | 'lyrics' | 'settings';
type Focus = 'sidebar' | 'main' | 'context';

function getTerminalWidth(): number {
  const cols = process.stdout.columns;
  if (typeof cols === 'number' && cols >= 20) return cols;
  return 80;
}
function cleanupTty(): void {
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode?.(false);
    } catch {
      // ignore — raw mode may already be off
    }
  }
  // Show the cursor and leave the alternate screen buffer.
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}

function routeLabel(route: Route): string {
  return route.toUpperCase();
}

function renderResponsive(
  info: {
    protocol: number;
    playerVersion: string;
    capabilities: string[];
    auth?: AuthStatusDataT;
    playback?: PlaybackChangedDataT | null;
    lyrics?: { kind: string; lineCount: number };
  },
  route: Route,
  focus: Focus,
  tier: LayoutTier,
  palette: CommandPalette,
): void {
  const width = getTerminalWidth();
  let sidebarLines: string[];
  let mainLines: string[];
  let contextLines: string[];

  if (tier === 'wide') {
    const sidebarWidth = Math.max(14, Math.floor(width * 0.22));
    const contextWidth = Math.max(20, Math.floor(width * 0.28));
    const mainWidth = width - sidebarWidth - contextWidth;
    sidebarLines = drawBox(
      [
        ' Home',
        ' Search',
        ' Library',
        ' Queue',
        ' Lyrics',
        ' Settings',
      ],
      { width: sidebarWidth, height: 8, title: 'spotoei', focused: focus === 'sidebar' },
    );
    mainLines = drawBox(
      [
        ` route:    ${routeLabel(route)}`,
        ` player:   ${info.playerVersion}`,
        ` proto:    v${String(info.protocol)}`,
        ` caps:     ${info.capabilities.join(', ')}`,
        ` auth:     ${info.auth?.state ?? 'pending'}`,
        ` playback: ${info.playback?.state ?? 'idle'} [vol:${Math.round((info.playback?.volume ?? 0) * 100)}%]`,
      ],
      { width: mainWidth, height: 8, title: 'main', focused: focus === 'main' },
    );
    contextLines = drawBox(
      [
        ` track:   ${info.playback?.track?.name ?? '(no track)'}`,
        ` artist:  ${info.playback?.track?.artists.join(', ') ?? '-'}`,
        ` lyrics:  ${info.lyrics ? `${info.lyrics.kind} (${info.lyrics.lineCount} lines)` : '(idle)'}`,
        '',
        ` commands: ${palette.size()}`,
        ' ? : palette',
        ' Esc : back',
        ' q : quit',
      ],
      { width: contextWidth, height: 10, title: 'context', focused: focus === 'context' },
    );
  } else if (tier === 'medium') {
    const sidebarWidth = Math.max(14, Math.floor(width * 0.28));
    const mainWidth = width - sidebarWidth;
    sidebarLines = drawBox(
      [' Home', ' Search', ' Library', ' Queue', ' Lyrics', ' Settings'],
      { width: sidebarWidth, height: 8, title: 'spotoei', focused: focus === 'sidebar' },
    );
    mainLines = drawBox(
      [
        ` route:    ${routeLabel(route)}`,
        ` player:   ${info.playerVersion}`,
        ` auth:     ${info.auth?.state ?? 'pending'}`,
        ` playback: ${info.playback?.state ?? 'idle'} [vol:${Math.round((info.playback?.volume ?? 0) * 100)}%]`,
        ` lyrics:   ${info.lyrics ? `${info.lyrics.kind} (${info.lyrics.lineCount} lines)` : '(idle)'}`,
      ],
      { width: mainWidth, height: 8, title: 'main', focused: focus === 'main' },
    );
    contextLines = [];
  } else {
    sidebarLines = [];
    mainLines = drawBox(
      [
        ` route:    ${routeLabel(route)}`,
        ` player:   ${info.playerVersion}`,
        ` auth:     ${info.auth?.state ?? 'pending'}`,
        ` playback: ${info.playback?.state ?? 'idle'}`,
        ` lyrics:   ${info.lyrics ? `${info.lyrics.kind} (${info.lyrics.lineCount} lines)` : '(idle)'}`,
      ],
      { width: width, height: 7, title: 'spotoei', focused: true },
    );
    contextLines = [];
  }

  const maxRows = Math.max(sidebarLines.length, mainLines.length, contextLines.length);
  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const s = sidebarLines[i] ?? ''.padEnd(tier === 'wide' ? 14 : tier === 'medium' ? 14 : 0);
    const m = mainLines[i] ?? '';
    const c = contextLines[i] ?? '';
    if (tier === 'wide' || tier === 'medium') {
      rows.push(s + m + c);
    } else {
      rows.push(m);
    }
  }
  rows.push(renderStatusBar({
    width,
    route,
    playbackState: info.playback?.state,
    trackName: info.playback?.track?.name,
    hint: '?: palette | Space: play | Esc: back | q: quit',
  }));

  process.stdout.write(rows.join('\n') + '\n');
}

function buildPalette(
  routes: { home: () => void; search: () => void; library: () => void; queue: () => void; lyrics: () => void; settings: () => void; },
  actions: { togglePlay: () => Promise<void>; cycleViz: () => void; getLyrics: () => Promise<void>; quit: () => void; },
): CommandPalette {
  const p = new CommandPalette();
  p.register({ id: 'nav.home', label: 'Go to Home', shortcut: 'g h', action: routes.home, keywords: ['root', 'main'] });
  p.register({ id: 'nav.search', label: 'Go to Search', shortcut: '/', action: routes.search, keywords: ['find'] });
  p.register({ id: 'nav.library', label: 'Go to Library', shortcut: 'g l', action: routes.library, keywords: ['saved', 'tracks'] });
  p.register({ id: 'nav.queue', label: 'Go to Queue', shortcut: 'g q', action: routes.queue, keywords: ['upcoming'] });
  p.register({ id: 'nav.lyrics', label: 'Open Lyrics', shortcut: 'l', action: routes.lyrics, keywords: ['words'] });
  p.register({ id: 'nav.settings', label: 'Open Settings', shortcut: 'g s', action: routes.settings, keywords: ['preferences'] });
  p.register({ id: 'act.play', label: 'Play / Pause', shortcut: 'Space', action: actions.togglePlay, keywords: ['audio'] });
  p.register({ id: 'act.viz', label: 'Cycle Visualizer', shortcut: 'v', action: actions.cycleViz, keywords: ['visualizer', 'spectrum'] });
  p.register({ id: 'act.lyrics.get', label: 'Fetch Lyrics', shortcut: 'L', action: actions.getLyrics, keywords: ['words'] });
  p.register({ id: 'act.quit', label: 'Quit SPOTOEI', shortcut: 'q', action: actions.quit, keywords: ['exit'] });
  return p;
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
    const onSignal = () => {
      cleanupTty();
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('SIGHUP', onSignal);
    process.on('exit', cleanupTty);
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
    // TUI state: route, focused panel, and command palette.
    const uiState: { route: Route; focus: Focus; tier: LayoutTier; paletteOpen: boolean } = {
      route: 'home',
      focus: 'main',
      tier: getLayoutTier(getTerminalWidth()),
      paletteOpen: false,
    };
    const refreshUi = (): void => {
      renderResponsive(currentInfo, uiState.route, uiState.focus, uiState.tier, palette);
    };
    const setRoute = (next: Route): void => {
      uiState.route = next;
      refreshUi();
    };
    const setFocus = (next: Focus): void => {
      uiState.focus = next;
      refreshUi();
    };
    const palette = buildPalette(
      {
        home: () => setRoute('home'),
        search: () => setRoute('search'),
        library: () => setRoute('library'),
        queue: () => setRoute('queue'),
        lyrics: () => setRoute('lyrics'),
        settings: () => setRoute('settings'),
      },
      {
        togglePlay: async () => {
          const state = currentInfo.playback?.state ?? 'idle';
          if (state === 'playing') await playback.pause();
          else await playback.play();
        },
        cycleViz: () => {
          const next = visualizer.cycleMode();
          currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
          refreshUi();
        },
        getLyrics: async () => {
          const uri = currentInfo.playback?.track?.uri ?? 'spotify:track:sample';
          try {
            const doc = await lyrics.getLyrics(uri);
            if (currentInfo.playback?.track?.uri !== uri) return;
            currentInfo.lyrics = { kind: doc.kind, lineCount: doc.lines.length };
            refreshUi();
          } catch {
            // Ignore lyrics retrieval failure in interactive mode
          }
        },
        quit: () => {
          process.stdin.removeListener('data', onKey);
        },
      },
    );

    const onResize = (): void => {
      uiState.tier = getLayoutTier(getTerminalWidth());
      refreshUi();
    };
    process.stdout.on('resize', onResize);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onKey = (chunk: string): void => {
        // Palette filtering mode
        if (uiState.paletteOpen) {
          if (chunk === '\u0003' || chunk === '\u001b') {
            palette.close();
            uiState.paletteOpen = false;
            refreshUi();
            return;
          }
          if (chunk === '\r' || chunk === '\n') {
            const cmd = palette.execute();
            uiState.paletteOpen = false;
            if (cmd) void cmd.action();
            refreshUi();
            return;
          }
          if (chunk === '\u001b[A' || chunk === 'k') {
            palette.prev();
            refreshUi();
            return;
          }
          if (chunk === '\u001b[B' || chunk === 'j') {
            palette.next();
            refreshUi();
            return;
          }
          if (chunk === '\u007f' || chunk === '\b') {
            const f = palette.getFilter();
            palette.setFilter(f.slice(0, -1));
            refreshUi();
            return;
          }
          if (chunk.length === 1 && chunk >= ' ' && chunk <= '~') {
            palette.setFilter(palette.getFilter() + chunk);
            refreshUi();
            return;
          }
          return;
        }
        if (chunk === '?' || chunk === ':') {
          palette.open();
          uiState.paletteOpen = true;
          refreshUi();
          return;
        }
        if (chunk === ' ') {
          const state = currentInfo.playback?.state ?? 'idle';
          if (state === 'playing') {
            void playback.pause();
          } else {
            void playback.play();
          }
          return;
        }
        if (chunk === '/') {
          setRoute('search');
          return;
        }
        if (chunk === '\u001b') {
          setRoute('home');
          return;
        }
        if (chunk === '\t') {
          // Only cycle between panels visible in the current layout tier.
          const order: Focus[] =
            uiState.tier === 'wide'
              ? ['main', 'sidebar', 'context']
              : uiState.tier === 'medium'
                ? ['main', 'sidebar']
                : ['main'];
          const idx = order.indexOf(uiState.focus);
          if (idx >= 0) {
            setFocus(order[(idx + 1) % order.length]);
          } else {
            setFocus(order[0]!);
          }
          return;
        }
        if (chunk === 'v' || chunk === 'V') {
          const next = visualizer.cycleMode();
          currentInfo.visualizer = { mode: next, fps: visualizer.getCurrentFps() };
          refreshUi();
          return;
        }
        if (chunk === 'l') {
          setRoute('lyrics');
          return;
        }
        if (chunk === 'L') {
          const uri = currentInfo.playback?.track?.uri ?? 'spotify:track:sample';
          lyrics
            .getLyrics(uri)
            .then((doc) => {
              if (currentInfo.playback?.track?.uri !== uri) return;
              currentInfo.lyrics = { kind: doc.kind, lineCount: doc.lines.length };
              refreshUi();
            })
            .catch(() => {
              // Ignore lyrics retrieval failure in interactive mode
            });
          return;
        }
        if (chunk === 'q' || chunk === 'Q' || chunk === '\u0003') {
          process.stdout.removeListener('resize', onResize);
          process.stdin.removeListener('data', onKey);
          cleanupTty();
          return;
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
