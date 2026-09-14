import type { CliRenderer } from '@opentui/core';

import { ViewPositionStore } from '../../navigation/viewPositions';
import { buildRoot } from '../componentTree';
import type {
  ContextMenuItem,
  FocusArea,
  Route,
  Ui,
  UiOptions,
  UiViewState,
  VisualizerFrame,
} from '../types';
import { createUiApi } from './api';
import { createContextMenuHelpers } from './contextMenu';
import { wireRenderableListeners } from './events';
import { createKeyDispatcher } from './keyboard';
import { createNavigationHelpers } from './navigation';
import { createPaletteHelpers } from './palette';
import { createPlaybackBarHelpers } from './playbackBar';
import { createRouteHelpers } from './route';
import type { UiCoreContext } from './types';
import { createVisualizerHelpers } from './visualizer';

// Build the entire controller: state bag, helpers, listeners, dispatcher,
// renderer, and the public `Ui` API. Splitting was forced by the < 300 LoC
// ceiling; the helpers are re-merged into a single `ctx.helpers` table
// after construction so downstream code can call any of them uniformly.
export function createUiCore(renderer: CliRenderer, initial: UiViewState, opts: UiOptions): Ui {
  const built = buildRoot({ renderer, state: initial });

  // Mutable state bag (single-cell objects so helpers can mutate in place
  // without React-style setter plumbing).
  const route = { current: { kind: 'home', tab: 'for_you' } as Route };
  const routeStack: Route[] = [];
  const positions = new ViewPositionStore();
  const focus = { current: 'sidebar' as FocusArea };
  const termWidth = {
    value:
      typeof (renderer as unknown as { terminalWidth?: unknown }).terminalWidth === 'number'
        ? (renderer as unknown as { terminalWidth: number }).terminalWidth
        : 120,
  };
  const sidebarPinned = { value: true };
  const latestVizFrame: { value: VisualizerFrame | null } = { value: null };
  const currentSearchHits = { value: [] as unknown[] as never };
  const lastSearch: UiCoreContext['lastSearch'] = { value: null };
  const searchFilter: UiCoreContext['searchFilter'] = { current: 'all' };
  const currentLibraryItems = { value: [] as never };
  const currentRouteItems: { value: unknown[] } = { value: [] };
  const currentHomeItems: UiCoreContext['currentHomeItems'] = { value: [] };
  const currentHomePanelRows: UiCoreContext['currentHomePanelRows'] = {
    value: { tracks: [], artists: [], recent: [], discover: [] },
  };
  const homeRange: UiCoreContext['homeRange'] = { current: 'medium_term' };
  const homePanel = { value: 0 };
  const searchPanel = { value: 0 };
  const searchPanelMaps: UiCoreContext['searchPanelMaps'] = {
    value: { tracks: [], artists: [], albums: [], playlists: [] },
  };
  const menu: { open: boolean; prevFocus: FocusArea; items: ContextMenuItem[] } = {
    open: false,
    prevFocus: 'sidebar',
    items: [],
  };
  const manualLyricsScroll = { value: false };
  const lyricsResumeTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };
  const drawerOpen = { value: false };
  const libraryHasMore = { value: undefined as boolean | undefined };
  const statusTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };
  const palette = {
    commands: [] as Array<{ name: string; description: string; action: () => void }>,
    filtered: [] as Array<{ name: string; description: string; action: () => void }>,
    open: false,
    prevFocus: 'sidebar' as FocusArea,
  };

  const ctx: UiCoreContext = {
    renderer,
    state: initial,
    opts,
    built,
    route,
    routeStack,
    positions,
    focus,
    termWidth,
    sidebarPinned,
    latestVizFrame,
    currentSearchHits: currentSearchHits as unknown as UiCoreContext['currentSearchHits'],
    lastSearch,
    searchFilter,
    currentLibraryItems: currentLibraryItems as unknown as UiCoreContext['currentLibraryItems'],
    currentRouteItems,
    currentHomeItems,
    currentHomePanelRows,
    homeRange,
    homePanel,
    searchPanel,
    searchPanelMaps,
    manualLyricsScroll,
    lyricsResumeTimer,
    drawerOpen,
    libraryHasMore,
    menu,
    palette,
    statusTimer,
    helpers: {} as UiCoreContext['helpers'],
  };

  // Merge all helper factories into the shared `ctx.helpers` table.
  const routeH = createRouteHelpers(ctx);
  const navH = createNavigationHelpers(ctx);
  const barH = createPlaybackBarHelpers(ctx);
  const vizH = createVisualizerHelpers(ctx);
  const paletteH = createPaletteHelpers(ctx);
  const menuH = createContextMenuHelpers(ctx);
  Object.assign(ctx.helpers, routeH, navH, barH, vizH, paletteH, menuH);

  wireRenderableListeners(ctx, opts, built);

  // Mount initial state. Unauthenticated boots straight into the
  // onboarding flow without pushing a spurious home entry onto the stack.
  ctx.helpers.showRoute(initial.auth.state === 'authenticated' ? 'home' : 'onboarding', true, true);
  ctx.helpers.setFocusArea(
    initial.auth.state === 'authenticated' && built.sidebar.visible ? 'sidebar' : 'main',
  );
  ctx.helpers.refreshNav();
  applyStateToTree(ctx);
  ctx.helpers.renderPlaybackBar();
  renderer.root.add(built.root);

  renderer.keyInput.on('keypress', createKeyDispatcher(ctx));

  renderer.start();

  return createUiApi(ctx);
}

// Aggregates one-shot content refreshes into a single call.
function applyStateToTree(ctx: UiCoreContext): void {
  ctx.helpers.setHeader();
  ctx.helpers.setVizTitle();
  ctx.helpers.paintViz();
  ctx.helpers.refreshHome();
  ctx.helpers.refreshSettings();
  ctx.helpers.refreshOnboarding();
}
