import { spawnSync, type ChildProcess } from 'node:child_process';
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
import type { AuthStatusDataT, PlaybackChangedDataT, SearchResponseT } from 'spotoei-protocol';
// eslint-disable-next-line no-control-regex
export function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\r\n]/g, ' ');
}

// Compute the visual column width of a string for terminal layout.
// CJK / full-width / emoji codepoints occupy two columns; everything
// else is a single column. Stays inline to avoid a new dependency.
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

function padBox(content: string, innerWidth = 40): string {
  // eslint-disable-next-line no-control-regex
  const visible = content.replace(/\u001b\[[0-9;]*m/g, '');
  const pad = Math.max(0, innerWidth - displayWidth(visible));
  return `│ ${content}${' '.repeat(pad)} │\n`;
}
function line(label: string, value: string): string {
  return padBox(`  ${label.padEnd(8)}${sanitize(value)}`);
}

function detail(label: string, value: string): string {
  return padBox(`  ${label.padEnd(8)}${sanitize(value)}`);
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
  const playerLine = info ? line('player', info.playerVersion) : line('player', '(spawning...)');
  const protoLine = info
    ? line('proto', `v${String(info.protocol)}`)
    : line('proto', '(pending...)');
  const caps = info
    ? info.capabilities.length
      ? info.capabilities.join(', ')
      : '(none)'
    : '(pending...)';

  const authLine = info?.auth ? line('auth', info.auth.state) : line('auth', '(pending...)');
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
let ttyEntered = false;
function enterTty(): void {
  if (ttyEntered) return;
  // Enter alternate screen, hide cursor, clear.
  process.stdout.write('\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H');
  ttyEntered = true;
}
function cleanupTty(): void {
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode?.(false);
    } catch {
      // ignore — raw mode may already be off
    }
  }
  if (ttyEntered) {
    process.stdout.write('\u001b[?25h\u001b[?1049l');
    ttyEntered = false;
  }
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
    statusMessage?: string;
  },
  route: Route,
  focus: Focus,
  tier: LayoutTier,
  palette: CommandPalette,
  paletteOpen: boolean,
): void {
  const width = getTerminalWidth();
  let sidebarLines: string[];
  let mainLines: string[];
  let contextLines: string[];

  const selectedRouteIndex = ['home', 'search', 'library', 'queue', 'lyrics', 'settings'].indexOf(
    route,
  );
  const sidebarItems = [' Home', ' Search', ' Library', ' Queue', ' Lyrics', ' Settings'].map(
    (label, idx) => (idx === selectedRouteIndex ? `▶${label}` : ` ${label}`),
  );

  if (tier === 'wide') {
    const sidebarWidth = Math.max(14, Math.floor(width * 0.22));
    const contextWidth = Math.max(20, Math.floor(width * 0.28));
    const mainWidth = width - sidebarWidth - contextWidth;
    sidebarLines = drawBox(sidebarItems, {
      width: sidebarWidth,
      height: 8,
      title: 'spotoei',
      focused: focus === 'sidebar',
    });
    mainLines = drawBox(
      route === 'search'
        ? [
            ` route:    search`,
            ` query:    ${info.search?.query ? sanitize(info.search.query.slice(0, 28)) : '(empty)'}`,
            ` hits:     ${info.search?.hitCount ?? 0}`,
            ` top:      ${info.search?.firstHit ? sanitize(info.search.firstHit.slice(0, 28)) : '(none)'}`,
            ` player:   ${info.playerVersion}`,
            ` auth:     ${info.auth?.state ?? 'pending'}`,
          ]
        : [
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
        ` track:   ${info.playback?.track?.name ? sanitize(info.playback.track.name) : '(no track)'}`,
        ` artist:  ${info.playback?.track?.artists ? sanitize(info.playback.track.artists.join(', ')) : '-'}`,
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
    sidebarLines = drawBox(sidebarItems, {
      width: sidebarWidth,
      height: 8,
      title: 'spotoei',
      focused: focus === 'sidebar',
    });
    mainLines = drawBox(
      route === 'search'
        ? [
            ` route:    search`,
            ` query:    ${info.search?.query ? sanitize(info.search.query.slice(0, 24)) : '(empty)'}`,
            ` hits:     ${info.search?.hitCount ?? 0}`,
            ` player:   ${info.playerVersion}`,
            ` auth:     ${info.auth?.state ?? 'pending'}`,
          ]
        : [
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
      route === 'search'
        ? [
            ` route:    search`,
            ` query:    ${info.search?.query ? sanitize(info.search.query.slice(0, 20)) : '(empty)'}`,
            ` hits:     ${info.search?.hitCount ?? 0}`,
            ` top:      ${info.search?.firstHit ? sanitize(info.search.firstHit.slice(0, 20)) : '(none)'}`,
          ]
        : [
            ` route:    ${routeLabel(route)}`,
            ` player:   ${info.playerVersion}`,
            ` auth:     ${info.auth?.state ?? 'pending'}`,
            ` playback: ${info.playback?.state ?? 'idle'}`,
            ` lyrics:   ${info.lyrics ? `${info.lyrics.kind} (${info.lyrics.lineCount} lines)` : '(idle)'}`,
          ],
      { width: width, height: 7, title: 'spotoei', focused: focus === 'main' },
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
  // Palette overlay: render filtered matches below panels when open.
  if (paletteOpen) {
    const matches = palette.matches();
    const filter = palette.getFilter();
    const sel = palette.getSelectedIndex();
    const paletteLines: string[] = [
      ` filter: ${filter || '(type to filter)'}`,
      ' ─────────────────────',
    ];
    const visible = matches.slice(0, 6);
    if (visible.length === 0) {
      paletteLines.push(' (no matches)');
    } else {
      for (let i = 0; i < visible.length; i++) {
        const cmd = visible[i]!;
        const marker = i === sel ? '▶' : ' ';
        const shortcut = cmd.shortcut ? ` [${cmd.shortcut}]` : '';
        paletteLines.push(`${marker} ${cmd.label}${shortcut}`);
      }
    }
    paletteLines.push(' ─────────────────────');
    paletteLines.push(' ↑/k ↓/j navigate | Enter execute | Esc close');
    const box = drawBox(paletteLines, {
      width: Math.min(width - 4, 48),
      title: 'palette',
      focused: true,
    });
    // Center the palette box by padding left
    const pad = Math.max(0, Math.floor((width - box[0]!.length) / 2));
    for (const l of box) rows.push(' '.repeat(pad) + l);
  }
  const statusHint =
    info.statusMessage ?? '?: palette | Space: play | Esc: back | q: quit | Tab: focus';
  rows.push(
    renderStatusBar({
      width,
      route,
      playbackState: info.playback?.state,
      trackName: info.playback?.track?.name,
      hint: statusHint,
    }),
  );

  // Clear before repaint to avoid stacking frames in scrollback.
  process.stdout.write('\u001b[H\u001b[2J' + rows.join('\n') + '\n');
}

function buildPalette(
  routes: {
    home: () => void;
    search: () => void;
    library: () => void;
    queue: () => void;
    lyrics: () => void;
    settings: () => void;
  },
  actions: {
    togglePlay: () => Promise<void>;
    cycleViz: () => void;
    getLyrics: () => Promise<void>;
    login: () => Promise<void>;
    quit: () => void;
  },
): CommandPalette {
  const p = new CommandPalette();
  p.register({
    id: 'nav.home',
    label: 'Go to Home',
    shortcut: 'g h',
    action: routes.home,
    keywords: ['root', 'main'],
  });
  p.register({
    id: 'nav.search',
    label: 'Go to Search',
    shortcut: '/',
    action: routes.search,
    keywords: ['find'],
  });
  p.register({
    id: 'nav.library',
    label: 'Go to Library',
    shortcut: 'g l',
    action: routes.library,
    keywords: ['saved', 'tracks'],
  });
  p.register({
    id: 'nav.queue',
    label: 'Go to Queue',
    shortcut: 'g q',
    action: routes.queue,
    keywords: ['upcoming'],
  });
  p.register({
    id: 'nav.lyrics',
    label: 'Open Lyrics',
    shortcut: 'l',
    action: routes.lyrics,
    keywords: ['words'],
  });
  p.register({
    id: 'nav.settings',
    label: 'Open Settings',
    shortcut: 'g s',
    action: routes.settings,
    keywords: ['preferences'],
  });
  p.register({
    id: 'act.play',
    label: 'Play / Pause',
    shortcut: 'Space',
    action: actions.togglePlay,
    keywords: ['audio'],
  });
  p.register({
    id: 'act.viz',
    label: 'Cycle Visualizer',
    shortcut: 'v',
    action: actions.cycleViz,
    keywords: ['visualizer', 'spectrum'],
  });
  p.register({
    id: 'act.lyrics.get',
    label: 'Fetch Lyrics',
    shortcut: 'L',
    action: actions.getLyrics,
    keywords: ['words'],
  });
  p.register({
    id: 'act.auth.login',
    label: 'Login with Spotify',
    shortcut: 'A',
    action: actions.login,
    keywords: ['auth', 'signin', 'spotify'],
  });
  p.register({
    id: 'act.quit',
    label: 'Quit SPOTOEI',
    shortcut: 'q',
    action: actions.quit,
    keywords: ['exit'],
  });
  return p;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1));
  }

  const isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY;
  if (!isTTY) {
    // Immediate visual feedback for non-TTY smoke test; TUI will not be used.
    renderShell();
  }

  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let child: ChildProcess | null = null;
  let palette: CommandPalette = new CommandPalette();

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
    cleanupTty();
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
    }
    requestQuit.trigger();
  };

  // Register signal and exit handlers before any async work or sidecar
  // spawning so a quick SIGINT never leaves an unmanaged zombie process.
  process.on('SIGINT', () => {
    void quit();
  });
  process.on('SIGTERM', () => {
    void quit();
  });
  process.on('SIGHUP', () => {
    void quit();
  });
  process.on('exit', cleanupTty);

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
      statusMessage?: string;
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

    // TUI state must be initialised before any callback that may call refreshUi.
    const initialTier: LayoutTier = getLayoutTier(getTerminalWidth());
    const uiState: {
      route: Route;
      focus: Focus;
      tier: LayoutTier;
      paletteOpen: boolean;
      searchBuffer: string;
    } = {
      route: 'home',
      focus: initialTier === 'narrow' ? 'main' : 'sidebar',
      tier: initialTier,
      paletteOpen: false,
      searchBuffer: '',
    };
    // Helper to show transient status messages (auto-clears after 2.5s).
    let statusTimer: ReturnType<typeof setTimeout> | null = null;
    const setStatus = (msg: string, persist = false): void => {
      currentInfo.statusMessage = msg;
      if (!isTTY) renderShell(currentInfo);
      else refreshUi();
      if (!persist) {
        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
          currentInfo.statusMessage = undefined;
          if (isTTY) refreshUi();
        }, 2500);
      }
    };
    let lastRenderAt = 0;
    const refreshUi = (): void => {
      if (!isTTY) return;
      const now = Date.now();
      if (now - lastRenderAt < 16) return;
      lastRenderAt = now;
      renderResponsive(
        currentInfo,
        uiState.route,
        uiState.focus,
        uiState.tier,
        palette,
        uiState.paletteOpen,
      );
    };
    const setRoute = (next: Route): void => {
      if (uiState.route === 'search' && next !== 'search') {
        uiState.searchBuffer = '';
      }
      uiState.route = next;
      if (next === 'library') {
        void libraryManager.refresh().catch(() => {
          // ignore background refresh error
        });
      }
      refreshUi();
    };
    const setFocus = (next: Focus): void => {
      uiState.focus = next;
      refreshUi();
    };

    // Register palette after refreshUi and requestQuit are available so
    // the quit action can properly resolve the TUI promise.
    palette = buildPalette(
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
          try {
            if (state === 'playing') await playback.pause();
            else await playback.play();
          } catch (e) {
            setStatus(`playback: ${e instanceof Error ? e.message : String(e)}`);
          }
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
          } catch (e) {
            setStatus(`lyrics: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
        quit: () => {
          requestQuit.trigger();
        },
      },
    );

    visualizer.subscribe((mode) => {
      currentInfo.visualizer = {
        mode,
        fps: visualizer.getCurrentFps(),
      };
      if (isTTY) refreshUi();
    });

    auth.onStatusChange((next) => {
      currentInfo.auth = {
        state: next.state,
        accountId: next.accountId,
        storage: next.storage,
        authUrl: next.authUrl,
      };
      if (isTTY) refreshUi();
    });

    playback.onChange((next) => {
      currentInfo.playback = next;
      if (isTTY) refreshUi();
    });
    queueManager.subscribe((snap) => {
      currentInfo.queue = {
        upcomingCount: snap.upcoming.length,
      };
      if (isTTY) refreshUi();
    });

    lyrics.subscribe((doc) => {
      currentInfo.lyrics = {
        kind: doc.kind,
        lineCount: doc.lines.length,
      };
      if (isTTY) refreshUi();
    });
    // Optional query argument for testing/smoke verification
    if (args[0] === 'search' && args[1]) {
      const q = args.slice(1).join(' ');
      const res: SearchResponseT = await searchClient.search(q);
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
      if (!isTTY) renderShell(currentInfo);
      else refreshUi();
    }

    const onResize = (): void => {
      if (!isTTY) return;
      uiState.tier = getLayoutTier(getTerminalWidth());
      // Clamp focus to visible panels after resize.
      const visible: Focus[] =
        uiState.tier === 'wide'
          ? ['main', 'sidebar', 'context']
          : uiState.tier === 'medium'
            ? ['main', 'sidebar']
            : ['main'];
      if (!visible.includes(uiState.focus)) uiState.focus = visible[0]!;
      refreshUi();
    };
    if (isTTY) process.stdout.on('resize', onResize);

    if (isTTY) {
      enterTty();
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let onKey: ((chunk: string) => void) | null = null;
      const inputClosed = requestQuit.promise.then(() => {
        if (onKey) process.stdin.removeListener('data', onKey);
        process.stdout.removeListener('resize', onResize);
        process.stdin.pause();
        cleanupTty();
      });
      onKey = (chunk: string): void => {
        // Palette filtering mode

        if (uiState.paletteOpen) {
          if (chunk === '\u0003') {
            palette.close();
            uiState.paletteOpen = false;
            void quit();
            return;
          }
          if (chunk === '\u001b') {
            palette.close();
            uiState.paletteOpen = false;
            refreshUi();
            return;
          }
          if (chunk === '\r' || chunk === '\n') {
            const cmd = palette.execute();
            uiState.paletteOpen = false;
            if (cmd) {
              const r = cmd.action();
              if (r instanceof Promise)
                r.catch((e) => setStatus(String(e instanceof Error ? e.message : e)));
            }
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
          // Handle pasted or multi-character ASCII input
          let append = '';
          for (const ch of chunk) {
            if (ch >= ' ' && ch <= '~') {
              append += ch;
            }
          }
          if (append.length > 0) {
            palette.setFilter(palette.getFilter() + append);
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
        if (chunk === '/') {
          setRoute('search');
          return;
        }
        if (uiState.route === 'search') {
          if (chunk === '\u001b' || chunk === '\r' || chunk === '\n') {
            if (chunk === '\r' || chunk === '\n') {
              const q = uiState.searchBuffer;
              if (q.length > 0) {
                searchClient
                  .search(q)
                  .then((res: SearchResponseT) => {
                    const first = res.hits[0];
                    let firstLabel = '(none)';
                    if (first) {
                      if (first.type === 'track') firstLabel = sanitize(first.track.name);
                      else if (first.type === 'album') firstLabel = sanitize(first.album.name);
                      else if (first.type === 'artist') firstLabel = sanitize(first.artist.name);
                      else if (first.type === 'playlist')
                        firstLabel = sanitize(first.playlist.name);
                    }
                    currentInfo.search = {
                      query: sanitize(q),
                      hitCount: res.hits.length,
                      firstHit: firstLabel,
                    };
                    refreshUi();
                  })
                  .catch((e: unknown) => {
                    setStatus(e instanceof Error ? e.message : String(e));
                  });
              }
            }
            if (chunk === '\u001b') {
              setRoute('home');
            }
            return;
          }
          if (chunk === '\u007f' || chunk === '\b') {
            uiState.searchBuffer = uiState.searchBuffer.slice(0, -1);
            refreshUi();
            return;
          }
          if (chunk.length === 1 && chunk >= ' ' && chunk <= '~') {
            uiState.searchBuffer += chunk;
            refreshUi();
            return;
          }
          return;
        }
        if (chunk === '\u001b') {
          if (uiState.paletteOpen) {
            palette.close();
            uiState.paletteOpen = false;
            refreshUi();
          } else {
            setRoute('home');
          }
          return;
        }
        if (chunk === '\t') {
          // Only cycle between panels visible in the current layout tier.
          const order: Focus[] =
            uiState.tier === 'wide'
              ? ['sidebar', 'main', 'context']
              : uiState.tier === 'medium'
                ? ['sidebar', 'main']
                : ['main'];
          const idx = order.indexOf(uiState.focus);
          if (idx >= 0) {
            setFocus(order[(idx + 1) % order.length]!);
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
            .catch((e: unknown) => {
              setStatus(e instanceof Error ? e.message : String(e));
            });
          return;
        }
        if (chunk === 'q' || chunk === 'Q' || chunk === '\u0003') {
          requestQuit.trigger();
          return;
        }
      };
      process.stdin.on('data', onKey);
      // Initial responsive render before any keypress.
      refreshUi();
      await inputClosed;
    } else {
      // Non-TTY (smoke test): render the static shell once and exit.
      renderShell(currentInfo);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (statusTimer) clearTimeout(statusTimer);
    process.stdout.removeListener('resize', onResize);
    searchClient.close();
    cache.close();
    playback.close();
    visualizer.stop();
    lyrics.close();
    auth.close();
  } catch (e) {
    cleanupTty();
    process.stderr.write(
      `spotoei: failed to start player: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

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
