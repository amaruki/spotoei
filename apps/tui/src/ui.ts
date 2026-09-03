// OpenTUI-based renderer for spotoei. Builds and owns the entire renderable
// tree, exposes an imperative API for state updates from `main.ts`,
// and forwards raw key events with focus and palette guards.

import {
  BoxRenderable,
  FrameBufferRenderable,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  bold,
  fg,
  t,
} from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import type {
  AuthStatusDataT,
  CatalogAlbumT,
  CatalogArtistT,
  CatalogPlaylistT,
  CatalogTrackT,
  LyricsDocumentT,
  PlaybackChangedDataT,
  PlaybackPositionDataT,
  QueueSnapshotT,
  SearchHitT,
  SearchResponseT,
  VisualizerModeT,
} from 'spotoei-protocol';

import { resolveClientId, getRedirectUri } from './config';

export type Route = 'home' | 'search' | 'library' | 'queue' | 'lyrics' | 'settings';
export type FocusArea = 'sidebar' | 'main';
export type LibraryItemT = CatalogTrackT | CatalogAlbumT | CatalogArtistT | CatalogPlaylistT;

export interface UiViewState {
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
  queue: QueueSnapshotT;
  visualizer: {
    mode: 'off' | VisualizerModeT;
    fps: number;
  };
  lyrics?: LyricsDocumentT;
  statusMessage?: string;
}

export interface VisualizerFrame {
  mode: VisualizerModeT;
  data: number[];
}

export type KeyDispatch = (key: {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  raw: string;
}) => void;

const COLOR_BG = '#0f1115';
const COLOR_PANEL_BG = '#15181f';
const COLOR_BORDER = '#3a4252';
const COLOR_BORDER_FOCUS = '#7aa2f7';
const COLOR_TEXT = '#c0caf5';
const COLOR_DIM = '#7a8595';
const COLOR_ACCENT = '#7aa2f7';
const COLOR_SUCCESS = '#9ece6a';
const COLOR_WARN = '#e0af68';


const COLOR_BAR_PEAK = '#bb9af7';

export interface Ui {
  setRoute(next: Route): void;
  getRoute(): Route;
  setFocus(next: FocusArea): void;
  getFocus(): FocusArea;
  setStatus(msg: string, persist?: boolean): void;
  setVisualizerFrame(frame: VisualizerFrame | null): void;
  setSearchResults(query: string, results: SearchResponseT): void;
  setLibraryItems(items: LibraryItemT[], error?: { code: string; message: string }): void;
  setLibraryLoading(loading: boolean): void;
  setLibraryLines(lines: string[], empty: boolean): void;
  setQueueSnapshot(snap: QueueSnapshotT): void;
  setLyrics(doc: LyricsDocumentT | null): void;
  setSearchLoading(loading: boolean): void;
  setPaletteCommands(cmds: Array<{ name: string; description: string; action: () => void }>): void;
  openPalette(): void;
  closePalette(): void;
  isPaletteOpen(): boolean;
  setPlayback(playback: PlaybackChangedDataT | null): void;
  setPlaybackPosition(pos: PlaybackPositionDataT): void;
  setAuth(auth: AuthStatusDataT): void;
  focusClientIdInput(): void;
  toggleVisualizer(): boolean;
  setVisualizerVisible(visible: boolean): void;
  isVisualizerVisible(): boolean;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface UiOptions {
  onKey: KeyDispatch;
  onSearchSubmit: (q: string) => void;
  onSelectSearchHit?: (hit: SearchHitT) => void;
  onSelectLibrary: (idx: number) => void;
  onSelectLibraryItem?: (item: LibraryItemT) => void;
  onSelectQueue: (idx: number) => void;
  onSaveClientId?: (clientId: string) => void | Promise<void>;
  onAuthenticate?: () => void | Promise<void>;
  onRouteChange?: (route: Route) => void;
}

interface BuildArgs {
  renderer: CliRenderer;
  state: UiViewState;
}


function cap(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 1) return chars.slice(0, max).join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

function formatArtists(artists?: unknown): string {
  if (!artists) return '—';
  if (typeof artists === 'string') return artists;
  if (!Array.isArray(artists) || artists.length === 0) return '—';
  return artists
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && 'name' in a && typeof (a as { name: unknown }).name === 'string') {
        return (a as { name: string }).name;
      }
      return String(a ?? '');
    })
    .filter(Boolean)
    .join(', ');
}

function authSummary(auth: UiViewState['auth']): string {
  const state = String(auth.state ?? 'unauthenticated');
  return `${state} • ${auth.accountId ?? 'no account'} • ${auth.storage ?? 'in-memory'}`;
}

function routeTitle(route: Route): string {
  switch (route) {
    case 'home':
      return 'Now Playing';
    case 'search':
      return 'Search';
    case 'library':
      return 'Library';
    case 'queue':
      return 'Queue';
    case 'lyrics':
      return 'Lyrics';
    case 'settings':
      return 'Settings';
  }
}

function getHomeContent(state: UiViewState) {
  const track = state.playback?.track;
  const artist = formatArtists(track?.artists as Array<string | { name: string }> | undefined);
  const album = track?.album ?? (track as { albumName?: string } | undefined)?.albumName ?? '—';
  const posSec = Math.floor((state.playback?.positionMs ?? 0) / 1000);
  const durSec = Math.floor((state.playback?.durationMs ?? 0) / 1000);
  const volPercent = Math.round((state.playback?.volume ?? 1) * 100);
  return t`${bold('Overview')}
${fg(COLOR_TEXT)(`Protocol: ${state.protocol}`)}
${fg(COLOR_TEXT)(`Player: ${state.playerVersion}`)}
${fg(COLOR_TEXT)(`Capabilities: ${state.capabilities.join(', ') || '(none)'}`)}

${fg(COLOR_TEXT)(`Track: ${typeof track?.name === 'string' ? track.name : '(idle)'}`)}
${fg(COLOR_TEXT)(`Artist: ${artist}`)}
${fg(COLOR_TEXT)(`Album: ${album}`)}
${fg(COLOR_TEXT)(`State: ${state.playback?.state ?? 'idle'}`)}
${fg(COLOR_TEXT)(`Position: ${posSec}s / ${durSec}s`)}
${fg(COLOR_TEXT)(`Volume: ${volPercent}%`)}
${fg(COLOR_TEXT)(`Shuffle: ${state.playback?.shuffle ? 'on' : 'off'}`)}
${fg(COLOR_TEXT)(`Repeat: ${state.playback?.repeat ?? 'off'}`)}
${fg(COLOR_TEXT)(`Autoplay: ${state.playback?.autoplay ? 'on' : 'off'}`)}`;
}

function getNavOptions(isAuthenticated: boolean) {
  if (!isAuthenticated) {
    return [
      { name: '🔒 Home', description: 'Requires login', value: 'home' },
      { name: '🔒 Search', description: 'Requires login', value: 'search' },
      { name: '🔒 Library', description: 'Requires login', value: 'library' },
      { name: '🔒 Queue', description: 'Requires login', value: 'queue' },
      { name: '⚙ Settings', description: 'Setup & Auth', value: 'settings' },
    ];
  }
  return [
    { name: 'Home', description: 'Now playing', value: 'home' },
    { name: 'Search', description: 'Find music', value: 'search' },
    { name: 'Library', description: 'Saved tracks', value: 'library' },
    { name: 'Queue', description: 'Upcoming', value: 'queue' },
    { name: 'Settings', description: 'Auth & info', value: 'settings' },
  ];
}

function getSettingsContent(state: UiViewState) {
  const clientRes = resolveClientId();
  const redirectUri = getRedirectUri();
  const isAuthenticated = state.auth.state === 'authenticated';

  if (!isAuthenticated) {
    if (!clientRes.clientId) {
      return t`${bold('== SETUP STEP 1 OF 2: Spotify Client ID ==')}
${fg(COLOR_WARN)('Spotoei requires setup & authentication before use.')}

1. Create a free app at: ${fg(COLOR_ACCENT)('https://developer.spotify.com/dashboard')}
2. In App Settings, add Redirect URI:
   ${fg(COLOR_ACCENT)(bold(redirectUri))}
3. Paste your Client ID below and press ${bold('Enter')}.`;
    }
    if (state.auth.state === 'authenticating') {
      return t`${bold('== STEP 2 OF 2: Authenticating ==')}
${fg(COLOR_ACCENT)(bold('Browser opened for authentication!'))}
${fg(COLOR_TEXT)('Complete the login in your browser window.')}

${bold('Redirect URI listening at:')}
${fg(COLOR_SUCCESS)(redirectUri)}

${fg(COLOR_DIM)('Waiting for Spotify login callback…')}
${fg(COLOR_DIM)('Press [A] to re-open browser  •  Press [C] to edit Client ID')}`;
    }
    return t`${bold('== SETUP STEP 2 OF 2: Authenticate ==')}
${fg(COLOR_SUCCESS)('✔ Client ID configured')} (${fg(COLOR_DIM)(clientRes.source)})
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Press [A] or [Enter]')} to open browser and log in with Spotify!
${fg(COLOR_DIM)('Press [C] to edit Client ID  •  Press [Q] to quit')}`;
  }

  return t`${bold('Account')}
${fg(COLOR_TEXT)(authSummary(state.auth))}

${bold('Spotify Client ID')}
${fg(COLOR_SUCCESS)(`Configured (${clientRes.source})`)}
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Storage & Capabilities')}
${fg(COLOR_TEXT)(String(state.auth.storage ?? 'in-memory'))} • ${fg(COLOR_DIM)(state.capabilities.join(', ') || '(none)')}

${fg(COLOR_DIM)('Press [A] to re-authenticate  •  Press [C] to update Client ID')}`;
}

function buildRoot({ renderer, state }: BuildArgs) {
  const root = new BoxRenderable(renderer, {
    id: 'root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: COLOR_BG,
  });

  // Header removed from top per user request ("hilangkan top bar")
  const headerText = new TextRenderable(renderer, {
    id: 'header-text',
    content: '',
  });

  // Main area (sidebar | main | right)
  const mainArea = new BoxRenderable(renderer, {
    id: 'main-area',
    flexDirection: 'row',
    flexGrow: 1,
    backgroundColor: COLOR_BG,
  });
  root.add(mainArea);

  // Sidebar (navigation)
  const sidebar = new BoxRenderable(renderer, {
    id: 'sidebar',
    width: 24,
    height: '100%',
    flexShrink: 0,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Navigation',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    focusable: true,
  });
  const nav = new SelectRenderable(renderer, {
    id: 'nav',
    options: getNavOptions(state.auth.state === 'authenticated'),
    showScrollIndicator: false,
    showDescription: true,
    itemSpacing: 0,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  sidebar.add(nav);
  mainArea.add(sidebar);

  // Center column
  const center = new BoxRenderable(renderer, {
    id: 'center',
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  });
  mainArea.add(center);

  const main = new BoxRenderable(renderer, {
    id: 'main',
    flexGrow: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Now Playing',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });
  center.add(main);

  // Home view
  const home = new BoxRenderable(renderer, {
    id: 'view-home',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
  });
  const homeText = new TextRenderable(renderer, {
    id: 'home-text',
    content: getHomeContent(state),
  });
  home.add(homeText);
  main.add(home);

  // Search view
  const search = new BoxRenderable(renderer, {
    id: 'view-search',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const searchInputBox = new BoxRenderable(renderer, {
    id: 'search-input-box',
    width: '100%',
    height: 3,
    borderStyle: 'single',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Search Spotify (Type query & press Enter)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const searchInput = new InputRenderable(renderer, {
    id: 'search-input',
    placeholder: 'Type search query and press Enter (no live search)…',
    width: '100%',
    backgroundColor: '#181818',
    focusedBackgroundColor: '#242424',
    textColor: '#FFFFFF',
    focusedTextColor: '#FFFFFF',
  });
  searchInputBox.add(searchInput);
  search.add(searchInputBox);

  const searchResultsBox = new BoxRenderable(renderer, {
    id: 'search-results-box',
    width: '100%',
    flexGrow: 1,
    marginTop: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Results (Press ↓ to browse, Enter to play)',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });
  const searchResults = new SelectRenderable(renderer, {
    id: 'search-results',
    options: [{ name: '(no results)', description: 'Type a query above and press Enter' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  searchResultsBox.add(searchResults);
  search.add(searchResultsBox);
  main.add(search);

  // Library view
  const library = new BoxRenderable(renderer, {
    id: 'view-library',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Saved Tracks (Press Enter to play, r to refresh)',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const libraryList = new SelectRenderable(renderer, {
    id: 'library-list',
    options: [{ name: '(library empty)', description: 'Loading saved tracks…' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  library.add(libraryList);
  main.add(library);

  // Queue view
  const queue = new BoxRenderable(renderer, {
    id: 'view-queue',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Playback Queue (Press Enter to play)',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const queueList = new SelectRenderable(renderer, {
    id: 'queue-list',
    options: [{ name: '(no upcoming tracks)', description: 'Add tracks via search' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  queue.add(queueList);
  main.add(queue);

  // Lyrics view (with scrollbox)
  const lyrics = new BoxRenderable(renderer, {
    id: 'view-lyrics',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const lyricsScroll = new ScrollBoxRenderable(renderer, {
    id: 'lyrics-scroll',
    width: '100%',
    flexGrow: 1,
  });
  const lyricsText = new TextRenderable(renderer, {
    id: 'lyrics-text',
    content: t`${fg(COLOR_DIM)('(no lyrics loaded — press L to fetch)')}`,
    wrapMode: 'word',
    width: '100%',
  });
  lyricsScroll.add(lyricsText);
  lyrics.add(lyricsScroll);
  main.add(lyrics);

  // Settings view
  const settings = new BoxRenderable(renderer, {
    id: 'view-settings',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const settingsText = new TextRenderable(renderer, {
    id: 'settings-text',
    content: getSettingsContent(state),
  });
  settings.add(settingsText);

  const clientIdBox = new BoxRenderable(renderer, {
    id: 'settings-client-id-box',
    width: '100%',
    flexDirection: 'column',
    marginTop: 1,
  });
  const clientIdLabel = new TextRenderable(renderer, {
    id: 'client-id-label',
    content: t`${bold('Configure Spotify Client ID')} ${fg(COLOR_DIM)('(press c / Enter to edit):')}`,
  });
  clientIdBox.add(clientIdLabel);
  const clientIdInput = new InputRenderable(renderer, {
    id: 'settings-client-id-input',
    placeholder: 'Paste Spotify Client ID here and press Enter…',
    width: '100%',
  });
  clientIdBox.add(clientIdInput);
  const clientIdHelp = new TextRenderable(renderer, {
    id: 'client-id-help',
    content: t`${fg(COLOR_DIM)('Press Enter to save to config.json')}`,
  });
  clientIdBox.add(clientIdHelp);
  settings.add(clientIdBox);
  main.add(settings);

  // Right column: visualizer
  const right = new BoxRenderable(renderer, {
    id: 'right',
    width: 36,
    flexShrink: 0,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Visualizer',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const visualizerTitle = new TextRenderable(renderer, {
    id: 'viz-title',
    content: t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`,
  });
  right.add(visualizerTitle);
  const visualizerFb = new FrameBufferRenderable(renderer, {
    id: 'viz-fb',
    width: 32,
    height: 10,
  });
  right.add(visualizerFb);
  mainArea.add(right);

  // Playback bottom bar (Now Playing, Progress Bar, Track Metadata, Status)
  const playbackBar = new BoxRenderable(renderer, {
    id: 'playback-bar',
    height: 5,
    flexDirection: 'column',
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Now Playing',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const playbackTrackText = new TextRenderable(renderer, {
    id: 'playback-track-text',
    content: t`${fg(COLOR_DIM)('■ No track playing')}`,
  });
  const playbackProgressText = new TextRenderable(renderer, {
    id: 'playback-progress-text',
    content: t`${fg(COLOR_DIM)('0:00  ────────────────────────────────────────────────────────────  0:00 (0%)')}`,
  });
  const statusText = new TextRenderable(renderer, {
    id: 'status',
    content: t`${fg(COLOR_DIM)('Space: play/pause  n: next  p: prev  V: viz  l: lyrics  S: shuffle  R: repeat  A: autoplay  /: search  r: library  u: queue  q: quit')}`,
  });
  playbackBar.add(playbackTrackText);
  playbackBar.add(playbackProgressText);
  playbackBar.add(statusText);
  root.add(playbackBar);

  // Command palette (absolute overlay)
  const palette = new BoxRenderable(renderer, {
    id: 'palette',
    position: 'absolute',
    top: 4,
    left: 6,
    width: 60,
    borderStyle: 'double',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Command Palette',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
    zIndex: 100,
  });
  const paletteInput = new InputRenderable(renderer, {
    id: 'palette-input',
    placeholder: 'Type to filter commands…',
    width: '100%',
  });
  const paletteList = new SelectRenderable(renderer, {
    id: 'palette-list',
    options: [],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: 8,
  });
  const paletteStatus = new TextRenderable(renderer, {
    id: 'palette-status',
    content: t`${fg(COLOR_DIM)('↑/↓ navigate • Enter execute • Esc close')}`,
  });
  palette.add(paletteInput);
  palette.add(paletteList);
  palette.add(paletteStatus);
  root.add(palette);

  return {
    root,
    sidebar,
    main,
    nav,
    home,
    homeText,
    search,
    library,
    queue,
    lyrics,
    lyricsScroll,
    settings,
    settingsText,
    clientIdInput,
    searchInputBox,
    searchInput,
    searchResultsBox,
    searchResults,
    libraryList,
    queueList,
    lyricsText,
    headerText,
    statusText,
    playbackBar,
    playbackTrackText,
    playbackProgressText,
    right,
    visualizerFb,
    palette,
    paletteList,
    paletteInput,
    paletteStatus,
    visualizerTitle,
  };
}

interface OptimizedBufferLike {
  width: number;
  height: number;
  clear(bg: RGBA): void;
  setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void;
}

const EIGHTH_BLOCKS = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

const VIZ_COLORS = [
  RGBA.fromHex('#73daca'), // teal (low bass)
  RGBA.fromHex('#7aa2f7'), // electric blue (mid bass)
  RGBA.fromHex('#89b4fa'), // sky blue (lower mid)
  RGBA.fromHex('#bb9af7'), // purple (upper mid)
  RGBA.fromHex('#c678dd'), // magenta (presence)
  RGBA.fromHex('#f7768e'), // pink (treble peak)
  RGBA.fromHex('#ff9e64'), // warm amber peak
];

function getBarColor(rowFromBottom: number, totalHeight: number): RGBA {
  const ratio = Math.max(0, Math.min(1, rowFromBottom / Math.max(1, totalHeight - 1)));
  const idx = Math.min(VIZ_COLORS.length - 1, Math.floor(ratio * VIZ_COLORS.length));
  return VIZ_COLORS[idx]!;
}

const peakHeights: number[] = Array.from({ length: 32 }, () => 0);
const peakFallSpeed: number[] = Array.from({ length: 32 }, () => 0);

function drawBars(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex('#15181f');
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0) return;

  const numBars = Math.min(w, 32);
  const barWidth = Math.max(1, Math.floor(w / numBars));
  const dataLen = data.length;

  for (let i = 0; i < numBars; i++) {
    // Dynamically aggregate frequency band slice across available data
    let v = 0;
    if (dataLen > 0) {
      const start = Math.floor((i / numBars) * dataLen);
      const end = Math.max(start + 1, Math.floor(((i + 1) / numBars) * dataLen));
      let sum = 0;
      let count = 0;
      for (let k = start; k < Math.min(dataLen, end); k++) {
        sum += data[k] ?? 0;
        count++;
      }
      v = count > 0 ? sum / count : (data[start] ?? 0);
    }
    v = Math.max(0, Math.min(1, v));

    // 1/8th Unicode block sub-character resolution (8x vertical detail)
    const totalEighths = Math.max(0, Math.min(h * 8, Math.round(v * (h * 8))));
    const fullRows = Math.floor(totalEighths / 8);
    const rem = totalEighths % 8;
    const x = i * barWidth;

    // Floating peak physics (gravity falloff)
    if (totalEighths >= (peakHeights[i] ?? 0)) {
      peakHeights[i] = totalEighths;
      peakFallSpeed[i] = 0;
    } else {
      peakFallSpeed[i] = (peakFallSpeed[i] ?? 0) + 0.4;
      peakHeights[i] = Math.max(0, (peakHeights[i] ?? 0) - (peakFallSpeed[i] ?? 0));
    }

    // Draw solid body rows
    for (let y = 0; y < fullRows; y++) {
      const row = h - 1 - y;
      const color = getBarColor(y, h);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, row, '█', color, bg);
        }
      }
    }

    // Draw fractional top block if present
    if (rem > 0 && fullRows < h) {
      const row = h - 1 - fullRows;
      const char = EIGHTH_BLOCKS[rem] ?? ' ';
      const color = getBarColor(fullRows, h);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, row, char, color, bg);
        }
      }
    }

    // Draw floating peak cap
    const peakRow = Math.min(h - 1, Math.floor((peakHeights[i] ?? 0) / 8));
    if (peakRow > fullRows && peakRow < h) {
      const peakColor = RGBA.fromHex(COLOR_BAR_PEAK);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, h - 1 - peakRow, '▔', peakColor, bg);
        }
      }
    }
  }
}

function drawWave(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex('#15181f');
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0 || data.length === 0) return;

  const center = Math.floor(h / 2);
  const centerColor = RGBA.fromHex('#3a4252');
  const wavePeakColor = RGBA.fromHex(COLOR_BAR_PEAK);
  const waveBodyColor = RGBA.fromHex(COLOR_ACCENT);

  // Draw subtle center baseline
  for (let x = 0; x < w; x++) {
    fb.setCell(x, center, '┄', centerColor, bg);
  }

  for (let x = 0; x < w; x++) {
    const v = data[Math.floor((x / w) * data.length)] ?? 0;
    const offset = Math.round(v * ((h - 1) / 2));
    const targetY = Math.max(0, Math.min(h - 1, center - offset));

    const minY = Math.min(targetY, center);
    const maxY = Math.max(targetY, center);

    for (let y = minY; y <= maxY; y++) {
      const ch = y === targetY ? '●' : '│';
      const color = y === targetY ? wavePeakColor : waveBodyColor;
      fb.setCell(x, y, ch, color, bg);
    }
  }
}

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function renderProgressBarStyled(positionMs: number, durationMs: number, totalWidth = 64) {
  const curStr = formatTime(positionMs);
  const durStr = formatTime(durationMs);
  const percent = durationMs > 0 ? Math.min(100, Math.max(0, Math.round((positionMs / durationMs) * 100))) : 0;
  const pctStr = `${percent}%`;

  const barWidth = Math.max(12, totalWidth - (curStr.length + durStr.length + pctStr.length + 8));
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const filledCount = Math.round(ratio * barWidth);
  const emptyCount = Math.max(0, barWidth - filledCount);

  const filledStr = filledCount > 1 ? '━'.repeat(filledCount - 1) : '';
  const thumbStr = filledCount > 0 ? '●' : '○';
  const emptyStr = '─'.repeat(emptyCount);

  return t`${fg(COLOR_ACCENT)(bold(curStr))}  ${fg(COLOR_ACCENT)(filledStr)}${fg(COLOR_BAR_PEAK)(bold(thumbStr))}${fg(COLOR_DIM)(emptyStr)}  ${fg(COLOR_TEXT)(durStr)}  ${fg(COLOR_DIM)(`(${pctStr})`)}`;
}

export async function createUi(initial: UiViewState, opts: UiOptions): Promise<Ui> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
  });
  return createUiCore(renderer, initial, opts);
}

export function createUiCore(renderer: CliRenderer, initial: UiViewState, opts: UiOptions): Ui {
  const state: UiViewState = { ...initial };
  let route: Route = 'home';
  let focus: FocusArea = 'sidebar';
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let manualLyricsScroll = false;
  let latestVizFrame: VisualizerFrame | null = null;
  let visualizerVisible = false;
  let currentSearchHits: SearchHitT[] = [];
  let currentLibraryItems: LibraryItemT[] = [];
  let paletteCommands: Array<{ name: string; description: string; action: () => void }> = [];
  let filteredCommands: Array<{ name: string; description: string; action: () => void }> = [];
  let paletteOpen = false;
  let previousFocusBeforePalette: FocusArea = 'main';

  const built = buildRoot({ renderer, state });
  const getFooterHelp = (): string => {
    if (state.auth.state !== 'authenticated') {
      if (route === 'settings' && built.clientIdInput.focused) {
        return 'Enter: save Client ID  Esc/Tab: exit input';
      }
      if (focus === 'sidebar') {
        return '↑/↓: navigate  Enter: select view  Tab/→: enter context  A: login  q: quit';
      }
      return 'A: authenticate  c: edit Client ID  Esc/Tab: navigation  q: quit';
    }
    if (focus === 'sidebar') {
      return '↑/↓: navigate  Enter: select view  Tab/→: enter view  q: quit';
    }
    // In main context:
    if (route === 'search') {
      if (built.searchInput.focused) {
        return 'Enter: search Spotify  ↓: results  Tab/Esc: navigation  q: quit';
      }
      return '↑/↓: select track  Enter: play  ↑ at top: edit search  Tab/Esc: navigation  q: quit';
    }
    if (route === 'library' || route === 'queue') {
      return '↑/↓: browse list  Enter: play  Tab/Esc: navigation  q: quit';
    }
    if (route === 'lyrics') {
      return '↑/↓: scroll  l/Esc: close lyrics  L: reload lyrics  q: quit';
    }
    return 'Space: play/pause  n: next  p: prev  l: lyrics  S: shuffle  R: repeat  A: autoplay  +/-: vol  Tab: nav  q: quit';
  };

  const updateSearchFocusVisuals = (inputFocused: boolean): void => {
    if (inputFocused) {
      built.searchInputBox.borderColor = COLOR_BORDER_FOCUS;
      built.searchInputBox.title = '▶ Search Spotify (Type query & press Enter)';
      built.searchResultsBox.borderColor = COLOR_BORDER;
      built.searchResultsBox.title = 'Results (Press ↓ to browse)';
    } else {
      built.searchInputBox.borderColor = COLOR_BORDER;
      built.searchInputBox.title = 'Search Spotify (Press ↑ to edit query)';
      built.searchResultsBox.borderColor = COLOR_BORDER_FOCUS;
      built.searchResultsBox.title = '▶ Results (Press ↑/↓ to browse, Enter to play)';
    }
  };

  const updateFocusVisuals = (): void => {
    const baseTitle =
      state.auth.state !== 'authenticated' && route === 'settings'
        ? 'Setup & Authentication'
        : routeTitle(route);

    if (focus === 'sidebar') {
      built.sidebar.borderColor = COLOR_BORDER_FOCUS;
      built.sidebar.title = '▶ Navigation [Active]';
      built.main.borderColor = COLOR_BORDER;
      built.main.title = baseTitle;
      if (route === 'search') {
        built.searchInputBox.borderColor = COLOR_BORDER;
        built.searchResultsBox.borderColor = COLOR_BORDER;
      }
      built.library.borderColor = COLOR_BORDER;
      built.queue.borderColor = COLOR_BORDER;
    } else {
      built.sidebar.borderColor = COLOR_BORDER;
      built.sidebar.title = 'Navigation';
      built.main.borderColor = COLOR_BORDER_FOCUS;
      built.main.title = `▶ ${baseTitle} [Active]`;
      if (route === 'search') {
        updateSearchFocusVisuals(built.searchInput.focused || !built.searchResults.focused);
      }
      built.library.borderColor = route === 'library' ? COLOR_BORDER_FOCUS : COLOR_BORDER;
      built.queue.borderColor = route === 'queue' ? COLOR_BORDER_FOCUS : COLOR_BORDER;
    }
  };

  const refreshNav = (): void => {
    built.nav.options = getNavOptions(state.auth.state === 'authenticated');
    setNavSelected(route);
  };

  const setNavSelected = (target: Route): void => {
    const options = built.nav.options;
    const idx = options.findIndex((o) => o.value === target);
    if (idx >= 0 && built.nav.getSelectedIndex() !== idx) {
      built.nav.setSelectedIndex(idx);
    }
  };

  const showRoute = (next: Route, force = false): void => {
    if (!force && state.auth.state !== 'authenticated' && next !== 'settings') {
      const clientRes = resolveClientId();
      if (!clientRes.clientId) {
        setStatus('Setup required: Please enter Spotify Client ID first (press c to edit)', true);
      } else {
        setStatus('Authentication required: Please log in with Spotify (press a or Enter to log in)', true);
      }
      next = 'settings';
    }

    route = next;
    built.home.visible = next === 'home';
    built.search.visible = next === 'search';
    built.library.visible = next === 'library';
    built.queue.visible = next === 'queue';
    built.lyrics.visible = next === 'lyrics';
    built.settings.visible = next === 'settings';
    if (next === 'lyrics') {
      // entering lyrics re-arms auto-scroll
      manualLyricsScroll = false;
    }
    setNavSelected(next);

    if (focus === 'main') {
      if (next === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        updateSearchFocusVisuals(true);
      } else {
        built.searchInput.blur();
        built.searchResults.blur();
      }
      if (next === 'settings') {
        refreshSettings();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
      } else {
        built.clientIdInput.blur();
      }
      if (next === 'library') {
        built.libraryList.focus();
      } else {
        built.libraryList.blur();
      }
      if (next === 'queue') {
        built.queueList.focus();
      } else {
        built.queueList.blur();
      }
    } else {
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
    }
    if (opts.onRouteChange) {
      opts.onRouteChange(next);
    }
  };

  const renderPlaybackBar = (): void => {
    const pb = state.playback;
    const track = pb?.track;
    const isPlaying = pb?.state === 'playing';
    const isPaused = pb?.state === 'paused';
    const stateIcon = isPlaying
      ? fg(COLOR_SUCCESS)(bold('▶ PLAYING'))
      : isPaused
        ? fg(COLOR_WARN)(bold('⏸ PAUSED'))
        : fg(COLOR_DIM)('■ IDLE');

    const authIndicator =
      state.auth.state === 'authenticated'
        ? fg(COLOR_SUCCESS)('● Online')
        : fg(COLOR_WARN)('○ Offline / Login Required');

    built.playbackBar.title = `Playback [${pb?.state ? pb.state.toUpperCase() : 'IDLE'}]  •  Spotoei ${authIndicator}`;

    if (!track) {
      built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_DIM)('No track playing — select a song from Library [r] or Search [/]')}`;
      built.playbackProgressText.content = t`${fg(COLOR_DIM)('0:00  ────────────────────────────────────────────────────────────  0:00 (0%)')}`;
      return;
    }

    const title = track.name || 'Untitled';
    const artists = formatArtists(track.artists);
    const album = track.album ?? '—';
    const genre = track.genre ?? '—';

    const vol = Math.round((pb?.volume ?? 1) * 100);
    const shuffle = pb?.shuffle ? 'on' : 'off';
    const repeat = pb?.repeat ?? 'off';

    // Line 1: Judul Lagu, Nama Artis, Album, Genre, Volume/Shuffle/Repeat
    built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_ACCENT)(bold(cap(title, 28)))}  ${fg(COLOR_DIM)('by')} ${fg(COLOR_TEXT)(cap(artists, 24))}  ${fg(COLOR_DIM)('•')}  ${fg(COLOR_DIM)('Album:')} ${fg(COLOR_TEXT)(cap(album, 20))}  ${fg(COLOR_DIM)('•')}  ${fg(COLOR_DIM)('Genre:')} ${fg(COLOR_SUCCESS)(cap(genre, 16))}  ${fg(COLOR_DIM)(`[Vol: ${vol}% | Shuf: ${shuffle} | Rep: ${repeat}]`)}`;

    // Line 2: Progress bar
    const posMs = pb?.positionMs ?? 0;
    const durMs = pb?.durationMs && pb.durationMs > 0 ? pb.durationMs : (track.durationMs ?? 0);
    built.playbackProgressText.content = renderProgressBarStyled(posMs, durMs, 64);
  };

  const setHeader = (): void => {
    renderPlaybackBar();
  };

  const setStatus = (msg: string, persist = false): void => {
    state.statusMessage = msg;
    const footerHelp = getFooterHelp();
    if (persist) {
      built.statusText.content = t`${fg(COLOR_WARN)(bold(msg))}`;
      return;
    }
    built.statusText.content = t`${fg(COLOR_TEXT)(msg)}  ${fg(COLOR_DIM)(footerHelp)}`;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      state.statusMessage = undefined;
      built.statusText.content = t`${fg(COLOR_DIM)(getFooterHelp())}`;
    }, 2500);
  };

  const setVizTitle = (): void => {
    built.visualizerTitle.content = t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`;
  };

  const paintViz = (): void => {
    if (!visualizerVisible) return;
    const fb = built.visualizerFb.frameBuffer;
    if (state.visualizer.mode === 'off' || !latestVizFrame) {
      fb.clear(RGBA.fromHex(COLOR_PANEL_BG));
      return;
    }
    if (latestVizFrame.mode === 'spectrum') {
      drawBars(fb as unknown as OptimizedBufferLike, latestVizFrame.data);
    } else {
      drawWave(fb as unknown as OptimizedBufferLike, latestVizFrame.data);
    }
  };

  const setVisualizerVisible = (visible: boolean): void => {
    visualizerVisible = visible;
    built.right.visible = visible;
    if (visible) {
      paintViz();
    }
  };

  const toggleVisualizer = (): boolean => {
    setVisualizerVisible(!visualizerVisible);
    return visualizerVisible;
  };

  const isVisualizerVisible = (): boolean => {
    return visualizerVisible;
  };

  const refreshHome = (): void => {
    built.homeText.content = getHomeContent(state);
  };

  const refreshSettings = (): void => {
    built.settingsText.content = getSettingsContent(state);
  };

  const setFocusArea = (next: FocusArea): void => {
    focus = next;
    updateFocusVisuals();

    if (next === 'sidebar') {
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
      built.nav.focus();
    } else {
      built.nav.blur();
      if (route === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        updateSearchFocusVisuals(true);
      } else if (route === 'settings') {
        refreshSettings();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
      } else if (route === 'library') {
        built.libraryList.focus();
      } else if (route === 'queue') {
        built.queueList.focus();
      }
      if (opts.onRouteChange) {
        opts.onRouteChange(route);
      }
    }
  };

  const updatePaletteList = (filter: string): void => {
    const needle = filter.toLowerCase().trim();
    filteredCommands = needle
      ? paletteCommands.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
        )
      : [...paletteCommands];
    if (filteredCommands.length === 0) {
      built.paletteList.options = [{ name: '(no matches)', description: '' }];
    } else {
      built.paletteList.options = filteredCommands.map((c) => ({
        name: c.name,
        description: c.description,
      }));
    }
    built.paletteList.setSelectedIndex(0);
  };

  const setPaletteOpen = (open: boolean): void => {
    paletteOpen = open;
    built.palette.visible = open;
    if (open) {
      previousFocusBeforePalette = focus;
      built.paletteInput.value = '';
      updatePaletteList('');
      built.paletteInput.focus();
    } else {
      built.paletteInput.blur();
      setFocusArea(previousFocusBeforePalette);
    }
  };

  const applyStateToTree = (): void => {
    setHeader();
    setVizTitle();
    paintViz();
    refreshHome();
    refreshSettings();
    built.lyricsText.content = renderLyricsContent(state);
  };

  // Wire sidebar navigation
  built.nav.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, option) => {
    const target = option?.value as Route | undefined;
    if (target) {
      showRoute(target);
      setFocusArea('main');
    }
  });
  // NOTE: SELECTION_CHANGED is intentionally NOT bound to showRoute.
  // Up/Down arrows only navigate menu items; only Enter activates the route!

  // Wire search input & results
  built.searchInput.on(InputRenderableEvents.ENTER, () => {
    const q = built.searchInput.value.trim();
    if (q.length > 0) {
      opts.onSearchSubmit(q);
    }
  });
  built.searchResults.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    const hit = currentSearchHits[idx];
    if (hit && opts.onSelectSearchHit) {
      opts.onSelectSearchHit(hit);
    }
  });

  // Wire library & queue selection
  built.libraryList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    const item = currentLibraryItems[idx];
    if (item && opts.onSelectLibraryItem) {
      opts.onSelectLibraryItem(item);
    }
    opts.onSelectLibrary(idx);
  });
  built.queueList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    opts.onSelectQueue(idx);
  });

  // Wire palette input filter
  built.paletteInput.on(InputRenderableEvents.CHANGE, (value: string) => {
    updatePaletteList(value);
  });

  // Wire client ID input
  built.clientIdInput.on(InputRenderableEvents.ENTER, () => {
    const val = built.clientIdInput.value.trim();
    if (val.length > 0) {
      if (opts.onSaveClientId) {
        void opts.onSaveClientId(val);
      }
      built.clientIdInput.value = '';
      built.clientIdInput.blur();
      refreshSettings();
    }
  });

  // Wire responsive resize: when the terminal is too narrow to show the
  // right pane, force the visualizer off. If width is sufficient, restore
  // the user's preferred state.
  renderer.on('resize', (w: number) => {
    if (w < 80) {
      visualizerVisible = false;
    }
    built.right.visible = w >= 80 && visualizerVisible;
  });
  // Initial mount
  showRoute(route);
  setFocusArea(focus);
  applyStateToTree();
  renderPlaybackBar();
  renderer.root.add(built.root);

  // Wire global key dispatch with focus isolation
  const dispatchKey = (e: {
    name: string;
    sequence: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
  }): void => {
    const key = {
      name: e.name,
      sequence: e.sequence,
      ctrl: e.ctrl,
      shift: e.shift,
      meta: e.meta,
      raw: e.sequence,
    };

    // 1. Palette open takes absolute keyboard precedence
    if (paletteOpen) {
      if (e.name === 'escape' || (e.ctrl && e.name === 'c')) {
        setPaletteOpen(false);
        return;
      }
      if (e.name === 'up') {
        const cur = built.paletteList.getSelectedIndex();
        built.paletteList.setSelectedIndex(Math.max(0, cur - 1));
        return;
      }
      if (e.name === 'down') {
        const cur = built.paletteList.getSelectedIndex();
        const max = Math.max(0, built.paletteList.options.length - 1);
        built.paletteList.setSelectedIndex(Math.min(max, cur + 1));
        return;
      }
      if (e.name === 'return') {
        const idx = built.paletteList.getSelectedIndex();
        const cmd = filteredCommands[idx];
        setPaletteOpen(false);
        if (cmd) {
          try {
            cmd.action();
          } catch (err) {
            setStatus(`palette: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return;
      }
      // Typing characters are consumed by paletteInput; do NOT trigger global hotkeys!
      return;
    }

    // 2. Search route input focus isolation
    if (route === 'search' && focus === 'main') {
      if (built.searchInput.focused) {
        if (e.ctrl && e.name === 'c') {
          opts.onKey(key);
          return;
        }
        if (e.name === 'escape' || e.name === 'tab') {
          built.searchInput.blur();
          setFocusArea('sidebar');
          return;
        }
        if (e.name === 'down') {
          built.searchInput.blur();
          built.searchResults.focus();
          updateSearchFocusVisuals(false);
          return;
        }
        if (e.name === 'return') {
          // Handled natively by InputRenderable.submit(), emitting InputRenderableEvents.ENTER
          return;
        }
        // Characters/spaces typed into searchInput are consumed here; do NOT trigger global hotkeys!
        return;
      }
      if (built.searchResults.focused) {
        if (e.ctrl && e.name === 'c') {
          opts.onKey(key);
          return;
        }
        if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
          built.searchResults.blur();
          setFocusArea('sidebar');
          return;
        }
        if (e.name === 'up' && built.searchResults.getSelectedIndex() === 0) {
          built.searchResults.blur();
          built.searchInput.focus();
          updateSearchFocusVisuals(true);
          return;
        }
        if (!e.shift && (e.name === '/' || e.name === 's' || e.sequence === '/')) {
          built.searchResults.blur();
          built.searchInput.focus();
          updateSearchFocusVisuals(true);
          return;
        }
        if (['up', 'down', 'return', 'pageup', 'pagedown', 'home', 'end'].includes(e.name)) {
          // Let SelectRenderable handle arrow/enter events for playing tracks
          return;
        }
      }
      // If neither is focused while in search route, focus search input
      built.searchInput.focus();
      updateSearchFocusVisuals(true);
      return;
    }

    // 3. Settings route Client ID input isolation
    if (route === 'settings' && built.clientIdInput.focused) {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (e.name === 'escape' || e.name === 'tab') {
        built.clientIdInput.blur();
        setFocusArea('sidebar');
        return;
      }
      // Characters/spaces typed into clientIdInput must NOT trigger global hotkeys!
      return;
    }

    if (route === 'settings' && focus === 'main' && !built.clientIdInput.focused) {
      if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
        setFocusArea('sidebar');
        return;
      }
      if (!e.shift && (e.name === 'a' || e.sequence === 'a')) {
        if (opts.onAuthenticate) {
          void opts.onAuthenticate();
        }
        return;
      }
      if (e.name === 'return') {
        const clientRes = resolveClientId();
        if (clientRes.clientId && state.auth.state !== 'authenticated') {
          if (opts.onAuthenticate) {
            void opts.onAuthenticate();
          }
          return;
        }
        built.clientIdInput.focus();
        return;
      }
      if (e.name === 'c' || e.name === 'i') {
        built.clientIdInput.focus();
        return;
      }
    }

    // 4. Sidebar navigation focus handling
    if (focus === 'sidebar') {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (state.auth.state !== 'authenticated' && (e.name === 'a' || e.name === 'A' || e.sequence === 'a' || e.sequence === 'A')) {
        if (opts.onAuthenticate) {
          void opts.onAuthenticate();
        }
        return;
      }
      if (e.name === 'tab' || e.name === 'right') {
        const sel = built.nav.getSelectedOption();
        const target = sel?.value as Route | undefined;
        if (target) {
          showRoute(target);
        }
        setFocusArea('main');
        return;
      }
      if (e.name === 'up' || e.name === 'down' || e.name === 'return') {
        // SelectRenderable handles up/down navigation and return selection
        return;
      }
    }

    // 4b. Library view focus handling
    if (route === 'library' && focus === 'main') {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
        setFocusArea('sidebar');
        return;
      }
      if (e.name === 'r' || e.name === 'R') {
        opts.onKey(key);
        return;
      }
      if (e.name === 'up' || e.name === 'down' || e.name === 'return') {
        // SelectRenderable handles list scrolling and enter selection
        return;
      }
    }

    // 4c. Queue view focus handling
    if (route === 'queue' && focus === 'main') {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
        setFocusArea('sidebar');
        return;
      }
      if (e.name === 'up' || e.name === 'down' || e.name === 'return') {
        // SelectRenderable handles list scrolling and enter selection
        return;
      }
    }

    // 5. Context exit keys (Esc/Tab/Left to return to sidebar or exit lyrics)
    if (focus === 'main') {
      if (e.name === 'escape' || e.name === 'left') {
        if (route === 'lyrics') {
          showRoute('home');
          setFocusArea('main');
          return;
        }
        setFocusArea('sidebar');
        return;
      }
      if (e.name === 'tab') {
        setFocusArea('sidebar');
        return;
      }
    }

    // 6. Quick number navigation when not typing in an input
    if (route !== 'search' && !built.clientIdInput.focused) {
      const numRoutes: Record<string, Route> = {
        '1': 'home',
        '2': 'search',
        '3': 'library',
        '4': 'queue',
        '5': 'lyrics',
        '6': 'settings',
      };
      const dest = numRoutes[e.name];
      if (dest) {
        showRoute(dest);
        setFocusArea('main');
        return;
      }
    }

    // 7. Lyrics scroll navigation
    if (route === 'lyrics' && focus === 'main') {
      if (e.name === 'up' || e.name === 'k') {
        manualLyricsScroll = true;
        built.lyricsScroll.scrollBy(-2);
        return;
      }
      if (e.name === 'down' || e.name === 'j') {
        manualLyricsScroll = true;
        built.lyricsScroll.scrollBy(2);
        return;
      }
    }

    if (opts.onKey) {
      opts.onKey(key);
    }
  };
  renderer.keyInput.on('keypress', dispatchKey);

  // Start renderer
  renderer.start();

  return {
    setRoute(next: Route): void {
      showRoute(next);
      setNavSelected(next);
      setFocusArea('main');
    },
    getRoute(): Route {
      return route;
    },
    setFocus(next: FocusArea): void {
      setFocusArea(next);
    },
    getFocus(): FocusArea {
      return focus;
    },
    setStatus,
    setVisualizerFrame(frame: VisualizerFrame | null): void {
      latestVizFrame = frame;
      paintViz();
    },
    setSearchResults(query: string, results: SearchResponseT): void {
      state.search = { query, hitCount: results.hits.length };
      currentSearchHits = results.hits;
      if (results.error) {
        built.searchResults.options = [
          {
            name: `⚠ ${results.error.code}`,
            description: results.error.message,
          },
        ];
      } else if (results.hits.length === 0) {
        built.searchResults.options = [{ name: '(no results)', description: `No Spotify matches found for "${query}"` }];
      } else {
        built.searchResults.options = results.hits.map((h) => {
          if (h.type === 'track') {
            const artists = formatArtists(h.track.artists);
            const album = h.track.albumName ? ` — ${h.track.albumName}` : '';
            return {
              name: `♪ ${h.track.name}`,
              description: `${artists}${album}`,
            };
          }
          if (h.type === 'album') {
            const artists = formatArtists(h.album.artists);
            return {
              name: `◈ ${h.album.name}`,
              description: `${artists} (album)`,
            };
          }
          if (h.type === 'artist') {
            return {
              name: `👤 ${h.artist.name}`,
              description: `${h.artist.followers ?? 0} followers (artist)`,
            };
          }
          return {
            name: `☰ ${h.playlist.name}`,
            description: `${h.playlist.trackCount ?? 0} tracks (playlist)`,
          };
        });
      }
      built.searchResults.setSelectedIndex(0);
    },
    setLibraryItems(
      items: LibraryItemT[],
      error?: { code: string; message: string },
    ): void {
      currentLibraryItems = items;
      if (error) {
        built.libraryList.options = [
          { name: `⚠ Library Error: ${error.code}`, description: error.message },
        ];
      } else if (items.length === 0) {
        built.libraryList.options = [
          {
            name: '(library empty)',
            description: 'No saved tracks found. Save songs on Spotify or press r to refresh.',
          },
        ];
      } else {
        built.libraryList.options = items.map((item) => {
          if ('durationMs' in item) {
            const artists = formatArtists(item.artists);
            const album = item.albumName ? ` — ${item.albumName}` : '';
            return {
              name: `♪ ${item.name}`,
              description: `${artists}${album}`,
            };
          }
          if ('albumGroup' in item || ('images' in item && 'artists' in item)) {
            const artists = formatArtists((item as CatalogAlbumT).artists);
            return {
              name: `◈ ${item.name}`,
              description: `${artists} (album)`,
            };
          }
          if ('followers' in item) {
            return {
              name: `👤 ${item.name}`,
              description: `${(item as CatalogArtistT).followers ?? 0} followers (artist)`,
            };
          }
          return {
            name: `☰ ${item.name}`,
            description: `${(item as CatalogPlaylistT).trackCount ?? 0} tracks (playlist)`,
          };
        });
      }
      built.libraryList.setSelectedIndex(0);
    },
    setLibraryLoading(loading: boolean): void {
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('loading library…')}`;
        built.libraryList.options = [
          { name: 'Loading Library…', description: 'Fetching your saved tracks from Spotify' },
        ];
        built.libraryList.setSelectedIndex(0);
      }
    },
    setLibraryLines(lines: string[], empty: boolean): void {
      if (empty || lines.length === 0) {
        built.libraryList.options = [{ name: '(empty)', description: 'Press r to refresh' }];
      } else {
        built.libraryList.options = lines.map((line) => ({
          name: line,
          description: '',
        }));
      }
    },
    setQueueSnapshot(snap: QueueSnapshotT): void {
      const items: { name: string; description: string }[] = [];
      if (snap.current) {
        items.push({
          name: `▶ ${snap.current.name}`,
          description: formatArtists(snap.current.artists),
        });
      }
      for (const item of snap.upcoming) {
        const track = item.track;
        items.push({
          name: track.name,
          description: `${formatArtists(track.artists)} (upcoming)`,
        });
      }
      if (items.length === 0) {
        built.queueList.options = [{ name: '(queue empty)', description: 'Add tracks via search' }];
      } else {
        built.queueList.options = items;
      }
      // Clear stale selection when the list shrinks so an off-by-one
      // selection does not leak from a prior snapshot.
      if (built.queueList.selectedIndex >= built.queueList.options.length) {
        built.queueList.setSelectedIndex(0);
      }
    },
    setLyrics(doc: LyricsDocumentT | null): void {
      state.lyrics = doc ?? undefined;
      built.lyricsText.content = renderLyricsContent(state);
    },
    setSearchLoading(loading: boolean): void {
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('searching Spotify…')}`;
        built.searchResults.options = [
          { name: 'Searching Spotify…', description: 'Please wait while querying Spotify Web API' },
        ];
        built.searchResults.setSelectedIndex(0);
      }
    },
    setPaletteCommands(
      cmds: Array<{ name: string; description: string; action: () => void }>,
    ): void {
      paletteCommands = cmds;
      filteredCommands = [...cmds];
    },
    openPalette(): void {
      setPaletteOpen(true);
    },
    closePalette(): void {
      setPaletteOpen(false);
    },
    isPaletteOpen(): boolean {
      return paletteOpen;
    },
    setPlayback(playback: PlaybackChangedDataT | null): void {
      state.playback = playback;
      setHeader();
      refreshHome();
    },
    setPlaybackPosition(pos: PlaybackPositionDataT): void {
      if (state.playback) {
        state.playback.positionMs = pos.positionMs;
        setHeader();
        refreshHome();
        if (route === 'lyrics' && !manualLyricsScroll && state.lyrics?.kind === 'synced') {
          built.lyricsText.content = renderLyricsContent(state);
          let activeIdx = -1;
          for (let i = 0; i < state.lyrics.lines.length; i++) {
            const line = state.lyrics.lines[i];
            if (line && line.startMs <= pos.positionMs) {
              activeIdx = i;
            } else {
              break;
            }
          }
          if (activeIdx >= 0) {
            built.lyricsScroll.scrollTo(Math.max(0, activeIdx - 3));
          }
        }
      }
    },
    setAuth(auth: AuthStatusDataT): void {
      const wasAuth = state.auth.state === 'authenticated';
       state.auth = auth;
       setHeader();
       refreshSettings();
       refreshNav();
       if (!wasAuth && auth.state === 'authenticated') {
         setStatus(`🎉 Authenticated as ${auth.accountId ?? 'user'}! Welcome to Spotoei.`, true);
         showRoute('home', true);
       }
     },
    focusClientIdInput(): void {
      showRoute('settings');
      setFocusArea('main');
      built.clientIdInput.focus();
    },
    toggleVisualizer,
    setVisualizerVisible,
    isVisualizerVisible,
    async start(): Promise<void> {
      // Renderer is already started.
    },
    async shutdown(): Promise<void> {
      if (statusTimer) clearTimeout(statusTimer);
      await renderer.destroy();
    },
  };
}

function renderLyricsContent(state: UiViewState): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press l to view, L to reload)';
  }
  if (doc.kind === 'plain') {
    return doc.lines.map((l) => l.text).join('\n\n');
  }
  const curPos = state.playback?.positionMs ?? 0;
  let activeIdx = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    if (line && line.startMs <= curPos) {
      activeIdx = i;
    } else {
      break;
    }
  }

  return doc.lines
    .map((l, i) => {
      const timeStr = formatTime(l.startMs);
      if (i === activeIdx) {
        return `▶ ${timeStr}  ${l.text}`;
      }
      return `  ${timeStr}  ${l.text}`;
    })
    .join('\n');
}
