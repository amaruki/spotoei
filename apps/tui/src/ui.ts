// OpenTUI-based renderer for spotoei. Builds and owns the entire renderable
// tree, exposes a small imperative API for state updates from `main.ts`,
// and forwards raw key events back to a single dispatch callback.
//
// We render all UI on top of @opentui/core: a root `BoxRenderable` with a
// fixed left/right column and a flex main area. Each `Route` is a dedicated
// view renderable. Visualizer frames are drawn into a `FrameBufferRenderable`
// in the right column.

import {
  BoxRenderable,
  FrameBufferRenderable,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
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
  LyricsDocumentT,
  PlaybackChangedDataT,
  QueueSnapshotT,
  SearchResponseT,
} from 'spotoei-protocol';

export type Route = 'home' | 'search' | 'library' | 'queue' | 'lyrics' | 'settings';
export type FocusArea = 'sidebar' | 'main';

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
    mode: 'off' | 'spectrum' | 'waveform';
    fps: number;
  };
  lyrics?: LyricsDocumentT;
  statusMessage?: string;
}

export interface VisualizerFrame {
  mode: 'spectrum' | 'waveform';
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
const COLOR_DANGER = '#f7768e';
const COLOR_BAR = '#7aa2f7';
const COLOR_BAR_PEAK = '#bb9af7';

export interface Ui {
  setRoute(next: Route): void;
  getRoute(): Route;
  setFocus(next: FocusArea): void;
  setStatus(msg: string, persist?: boolean): void;
  setVisualizerFrame(frame: VisualizerFrame | null): void;
  setSearchResults(query: string, results: SearchResponseT): void;
  setLibraryLines(lines: string[], empty: boolean): void;
  setQueueSnapshot(snap: QueueSnapshotT): void;
  setLyrics(doc: LyricsDocumentT | null): void;
  setSearchLoading(loading: boolean): void;
  setPaletteCommands(cmds: Array<{ name: string; description: string; action: () => void }>): void;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface UiOptions {
  onKey: KeyDispatch;
  onSearchSubmit: (q: string) => void;
  onSelectLibrary: (idx: number) => void;
  onSelectQueue: (idx: number) => void;
}

interface BuildArgs {
  renderer: CliRenderer;
  state: UiViewState;
  opts: UiOptions;
}

const BARS_PER_FB = 32;

function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return `${s.slice(0, max - 1)}…`;
}

function statusColor(state: string | undefined): string {
  switch (state) {
    case 'authenticated':
      return COLOR_SUCCESS;
    case 'pending':
      return COLOR_WARN;
    case 'failed':
      return COLOR_DANGER;
    default:
      return COLOR_DIM;
  }
}

function authSummary(auth: AuthStatusDataT): string {
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

function homeViewContent(renderer: CliRenderer, state: UiViewState): TextRenderable {
  const track = state.playback?.track;
  const lines: string[] = [
    `Protocol: ${state.protocol}`,
    `Player: ${state.playerVersion}`,
    `Capabilities: ${state.capabilities.join(', ') || '(none)'}`,
    '',
    `Track: ${track?.name ?? '(idle)'}`,
    `Artist: ${track?.artist ?? '—'}`,
    `Album: ${track?.album ?? '—'}`,
    `State: ${state.playback?.state ?? 'idle'}`,
    `Position: ${Math.floor((state.playback?.positionMs ?? 0) / 1000)}s`,
  ];
  return new TextRenderable(renderer, {
    id: 'home-text',
    content: t`${bold('Overview')}\n${lines.map((l) => fg(COLOR_TEXT)(l)).join('\n')}`,
  });
}

function settingsViewContent(renderer: CliRenderer, state: UiViewState): TextRenderable {
  return new TextRenderable(renderer, {
    id: 'settings-text',
    content: t`${bold('Account')}\n${fg(COLOR_TEXT)(authSummary(state.auth))}\n\n${bold('Storage')}\n${fg(COLOR_TEXT)(String(state.auth.storage ?? 'in-memory'))}\n\n${bold('Capabilities')}\n${fg(COLOR_TEXT)(state.capabilities.join(', ') || '(none)')}\n\n${bold('Doctor')}\n${fg(COLOR_DIM)('Run: spotoei doctor')}\n${fg(COLOR_DIM)('Run: SPOTOEI_CLIENT_ID=… spotoei')}`,
  });
}

function searchInputView(renderer: CliRenderer): InputRenderable {
  return new InputRenderable(renderer, {
    id: 'search-input',
    placeholder: 'Type to search Spotify (Enter to submit, Esc to back)…',
    width: '100%',
  });
}

function searchResultsView(renderer: CliRenderer): SelectRenderable {
  return new SelectRenderable(renderer, {
    id: 'search-results',
    options: [{ name: '(no results)', description: 'Type a query above' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
  });
}

function libraryView(renderer: CliRenderer): SelectRenderable {
  return new SelectRenderable(renderer, {
    id: 'library-list',
    options: [{ name: '(empty)', description: 'Press r to refresh' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
  });
}

function queueView(renderer: CliRenderer): SelectRenderable {
  return new SelectRenderable(renderer, {
    id: 'queue-list',
    options: [{ name: '(no upcoming tracks)', description: 'Add tracks via search' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
  });
}

function lyricsView(renderer: CliRenderer): TextRenderable {
  return new TextRenderable(renderer, {
    id: 'lyrics-text',
    content: t`${fg(COLOR_DIM)('(no lyrics loaded — press L to fetch)')}`,
    wrapMode: 'word',
    width: '100%',
    height: '100%',
  });
}

function buildRoot({ renderer, state, opts }: BuildArgs): {
  root: BoxRenderable;
  sidebar: BoxRenderable;
  main: BoxRenderable;
  nav: SelectRenderable;
  home: BoxRenderable;
  search: BoxRenderable;
  library: BoxRenderable;
  queue: BoxRenderable;
  lyrics: BoxRenderable;
  settings: BoxRenderable;
  searchInput: InputRenderable;
  searchResults: SelectRenderable;
  libraryList: SelectRenderable;
  queueList: SelectRenderable;
  lyricsText: TextRenderable;
  headerText: TextRenderable;
  statusText: TextRenderable;
  visualizerFb: FrameBufferRenderable;
  palette: BoxRenderable;
  paletteList: SelectRenderable;
  paletteInput: InputRenderable;
  paletteStatus: TextRenderable;
  visualizerTitle: TextRenderable;
} {
  const root = new BoxRenderable(renderer, {
    id: 'root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: COLOR_BG,
  });

  // Header
  const header = new BoxRenderable(renderer, {
    id: 'header',
    flexDirection: 'row',
    height: 3,
    paddingLeft: 1,
    paddingRight: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
  });
  const headerText = new TextRenderable(renderer, {
    id: 'header-text',
    content: t`${fg(COLOR_ACCENT)(bold('SPOTOEI'))} ${fg(COLOR_DIM)('— Spotify TUI')}`,
  });
  header.add(headerText);
  root.add(header);

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
    width: 22,
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
    options: [
      { name: 'Home', description: 'Overview & now playing', value: 'home' },
      { name: 'Search', description: 'Find tracks / artists', value: 'search' },
      { name: 'Library', description: 'Saved tracks / albums', value: 'library' },
      { name: 'Queue', description: 'Upcoming tracks', value: 'queue' },
      { name: 'Lyrics', description: 'Synced lyrics', value: 'lyrics' },
      { name: 'Settings', description: 'Auth & info', value: 'settings' },
    ],
    showScrollIndicator: false,
    showDescription: true,
    itemSpacing: 0,
    width: '100%',
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
  home.add(homeViewContent(renderer, state));
  main.add(home);

  // Search view
  const search = new BoxRenderable(renderer, {
    id: 'view-search',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const searchInput = searchInputView(renderer);
  const searchResults = searchResultsView(renderer);
  search.add(searchInput);
  const sep = new BoxRenderable(renderer, { id: 'search-sep', height: 1 });
  search.add(sep);
  search.add(searchResults);
  main.add(search);

  // Library view
  const library = new BoxRenderable(renderer, {
    id: 'view-library',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const libraryList = libraryView(renderer);
  library.add(libraryList);
  main.add(library);

  // Queue view
  const queue = new BoxRenderable(renderer, {
    id: 'view-queue',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const queueList = queueView(renderer);
  queue.add(queueList);
  main.add(queue);

  // Lyrics view
  const lyrics = new BoxRenderable(renderer, {
    id: 'view-lyrics',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const lyricsText = lyricsView(renderer);
  lyrics.add(lyricsText);
  main.add(lyrics);

  // Settings view
  const settings = new BoxRenderable(renderer, {
    id: 'view-settings',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  settings.add(settingsViewContent(renderer, state));
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

  // Footer
  const footer = new BoxRenderable(renderer, {
    id: 'footer',
    height: 3,
    flexDirection: 'row',
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    paddingLeft: 1,
    paddingRight: 1,
  });
  const statusText = new TextRenderable(renderer, {
    id: 'status',
    content: t`${fg(COLOR_DIM)('?: palette  ')}${fg(COLOR_DIM)('Space: play  ')}${fg(COLOR_DIM)('Tab: focus  ')}${fg(COLOR_DIM)('Esc: back  ')}${fg(COLOR_DIM)('q: quit')}`,
  });
  footer.add(statusText);
  root.add(footer);

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

  // Wire input handlers
  searchInput.on(InputRenderableEvents.ENTER, () => {
    opts.onSearchSubmit(searchInput.value);
  });
  libraryList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    opts.onSelectLibrary(idx);
  });
  queueList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    opts.onSelectQueue(idx);
  });

  return {
    root,
    sidebar,
    main,
    nav,
    home,
    search,
    library,
    queue,
    lyrics,
    settings,
    searchInput,
    searchResults,
    libraryList,
    queueList,
    lyricsText,
    headerText,
    statusText,
    visualizerFb,
    palette,
    paletteList,
    paletteInput,
    paletteStatus,
    visualizerTitle,
  };
}

function drawBars(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex('#15181f');
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  const barWidth = Math.max(1, Math.floor(w / BARS_PER_FB));
  for (let i = 0; i < BARS_PER_FB; i++) {
    const v = data[i] ?? 0;
    const barH = Math.max(0, Math.min(h, Math.floor(v * h)));
    const x = i * barWidth;
    for (let y = 0; y < barH; y++) {
      const row = h - 1 - y;
      for (let dx = 0; dx < barWidth - 1; dx++) {
        const color = y === barH - 1 ? COLOR_BAR_PEAK : COLOR_BAR;
        fb.setCell(x + dx, row, '█', RGBA.fromHex(color), bg);
      }
    }
  }
}

function drawWave(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex('#15181f');
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (data.length === 0) return;
  for (let x = 0; x < w; x++) {
    const v = data[Math.floor((x / w) * data.length)] ?? 0;
    const center = Math.floor(h / 2);
    const half = Math.floor(v * (h / 2));
    const top = center - half;
    for (let y = top; y < center + half; y++) {
      fb.setCell(x, y, '│', RGBA.fromHex(COLOR_ACCENT), bg);
    }
    fb.setCell(x, center, '─', RGBA.fromHex(COLOR_BAR_PEAK), bg);
  }
}

interface OptimizedBufferLike {
  width: number;
  height: number;
  clear(bg: RGBA): void;
  setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void;
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
  const built = buildRoot({ renderer, state, opts });

  let route: Route = 'home';
  let focus: FocusArea = 'main';
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let paletteCommands: Array<{ name: string; description: string; action: () => void }> = [];
  let paletteOpen = false;
  let latestVizFrame: VisualizerFrame | null = null;

  const showRoute = (next: Route): void => {
    route = next;
    built.home.visible = next === 'home';
    built.search.visible = next === 'search';
    built.library.visible = next === 'library';
    built.queue.visible = next === 'queue';
    built.lyrics.visible = next === 'lyrics';
    built.settings.visible = next === 'settings';
    built.main.title = routeTitle(next);
    if (next === 'search') {
      built.searchInput.focus();
    } else {
      built.searchInput.blur();
    }
  };

  const setHeader = (): void => {
    const authText = fg(statusColor(state.auth.state))(
      bold(String(state.auth.state ?? 'unauthenticated').toUpperCase()),
    );
    const stateText = fg(COLOR_TEXT)(state.playback?.state ? String(state.playback.state) : 'idle');
    const trackText = fg(COLOR_TEXT)(cap(state.playback?.track?.name ?? '(no track)', 40));
    built.headerText.content = t`${fg(COLOR_ACCENT)(bold('SPOTOEI'))}  ${authText}  •  ${stateText}  •  ${trackText}`;
  };

  const setStatus = (msg: string, persist = false): void => {
    state.statusMessage = msg;
    if (persist) {
      built.statusText.content = t`${fg(COLOR_WARN)(bold(msg))}`;
      return;
    }
    built.statusText.content = t`${fg(COLOR_TEXT)(msg)}  ${fg(COLOR_DIM)('?: palette  Space: play  Tab: focus  Esc: back  q: quit')}`;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      state.statusMessage = undefined;
      built.statusText.content = t`${fg(COLOR_DIM)('?: palette  Space: play  Tab: focus  Esc: back  q: quit')}`;
    }, 2500);
  };

  const setVizTitle = (): void => {
    built.visualizerTitle.content = t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`;
  };

  const paintViz = (): void => {
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

  const refreshHome = (): void => {
    built.home.remove(built.home.getRenderable('home-text')!);
    const next = homeViewContent(renderer, state);
    next.id = 'home-text';
    built.home.add(next);
  };
  const refreshSettings = (): void => {
    built.settings.remove(built.settings.getRenderable('settings-text')!);
    const next = settingsViewContent(renderer, state);
    next.id = 'settings-text';
    built.settings.add(next);
  };

  const setFocusArea = (next: FocusArea): void => {
    focus = next;
    if (next === 'sidebar') {
      built.nav.focus();
    } else {
      built.nav.blur();
    }
  };

  const setNavSelected = (target: Route): void => {
    const options = built.nav.options;
    const idx = options.findIndex((o) => o.value === target);
    if (idx >= 0) built.nav.setSelectedIndex(idx);
  };

  const setPaletteOpen = (open: boolean): void => {
    paletteOpen = open;
    built.palette.visible = open;
    if (open) {
      built.paletteInput.value = '';
      updatePaletteList('');
      built.paletteInput.focus();
    } else {
      built.paletteInput.blur();
      if (focus === 'main' && route === 'search') built.searchInput.focus();
    }
  };

  const updatePaletteList = (filter: string): void => {
    const needle = filter.toLowerCase();
    const filtered = needle
      ? paletteCommands.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
        )
      : paletteCommands;
    if (filtered.length === 0) {
      built.paletteList.options = [{ name: '(no matches)', description: '' }];
    } else {
      built.paletteList.options = filtered.map((c) => ({
        name: c.name,
        description: c.description,
      }));
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

  // Initial mount
  showRoute(route);
  applyStateToTree();
  renderer.root.add(built.root);

  // Wire global key dispatch
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
    if (paletteOpen) {
      if (e.name === 'escape' || (e.ctrl && e.name === 'c')) {
        setPaletteOpen(false);
        return;
      }
      if (e.name === 'return') {
        const cmds = paletteCommands;
        const idx = built.paletteList.getSelectedIndex();
        const cmd = cmds[idx];
        if (cmd) {
          try {
            cmd.action();
          } catch (err) {
            setStatus(`palette: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return;
      }
    }
    opts.onKey(key);
  };
  renderer.keyInput.on('keypress', dispatchKey);

  // Wire palette input filter
  built.paletteInput.on(InputRenderableEvents.CHANGE, (value: string) => {
    updatePaletteList(value);
  });

  // Start renderer
  renderer.start();
  // Drive visualizer repaint at ~30fps
  const tickInterval = setInterval(() => {
    paintViz();
  }, 33);

  return {
    setRoute(next: Route): void {
      showRoute(next);
      setNavSelected(next);
    },
    getRoute(): Route {
      return route;
    },
    setFocus(next: FocusArea): void {
      setFocusArea(next);
    },
    setStatus,
    setVisualizerFrame(frame: VisualizerFrame | null): void {
      latestVizFrame = frame;
      paintViz();
    },
    setSearchResults(query: string, results: SearchResponseT): void {
      state.search = { query, hitCount: results.hits.length };
      if (results.hits.length === 0) {
        built.searchResults.options = [{ name: '(no results)', description: query }];
      } else {
        built.searchResults.options = results.hits.map((h) => {
          if (h.type === 'track') {
            return {
              name: h.track.name,
              description: `${h.track.artist ?? 'Unknown'} — ${h.track.album ?? ''}`,
            };
          }
          if (h.type === 'album') {
            return {
              name: h.album.name,
              description: `${h.album.artist ?? 'Unknown'} (album)`,
            };
          }
          if (h.type === 'artist') {
            return {
              name: h.artist.name,
              description: `${h.artist.followers ?? 0} followers (artist)`,
            };
          }
          return {
            name: h.playlist.name,
            description: `${h.playlist.tracks ?? 0} tracks (playlist)`,
          };
        });
      }
    },
    setLibraryLines(lines: string[], empty: boolean): void {
      if (empty) {
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
          description: `${snap.current.artist ?? 'Unknown'}`,
        });
      }
      for (const track of snap.upcoming) {
        items.push({
          name: track.name,
          description: `${track.artist ?? 'Unknown'} (upcoming)`,
        });
      }
      if (items.length === 0) {
        built.queueList.options = [{ name: '(queue empty)', description: 'Add tracks via search' }];
      } else {
        built.queueList.options = items;
      }
    },
    setLyrics(doc: LyricsDocumentT | null): void {
      state.lyrics = doc ?? undefined;
      built.lyricsText.content = renderLyricsContent(state);
    },
    setSearchLoading(loading: boolean): void {
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('searching…')}`;
      }
    },
    setPaletteCommands(
      cmds: Array<{ name: string; description: string; action: () => void }>,
    ): void {
      paletteCommands = cmds;
    },
    async start(): Promise<void> {
      // Renderer is already started; nothing else to do.
    },
    async shutdown(): Promise<void> {
      clearInterval(tickInterval);
      await renderer.destroy();
    },
  };
}

function renderLyricsContent(state: UiViewState): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press L to fetch)';
  }
  if (doc.kind === 'plain') {
    return doc.lines.map((l) => l.text).join('\n');
  }
  return doc.lines
    .map((l) => {
      const time = `${String(l.startMs).padStart(5, ' ')}ms`;
      return `${time}  ${l.text}`;
    })
    .join('\n');
}
