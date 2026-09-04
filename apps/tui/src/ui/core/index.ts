import type { CliRenderer } from '@opentui/core';
import { InputRenderableEvents, SelectRenderableEvents } from '@opentui/core';

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
import { createKeyDispatcher } from './keyboard';
import { createNavigationHelpers } from './navigation';
import { createPaletteHelpers } from './palette';
import { createPlaybackBarHelpers } from './playbackBar';
import { createRouteHelpers } from './route';
import { createVisualizerHelpers } from './visualizer';
import type { AnySelect, UiCoreContext } from './types';

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
  const visualizerVisible = { value: false };
  const latestVizFrame: { value: VisualizerFrame | null } = { value: null };
  const currentSearchHits = { value: [] as unknown[] as never };
  const currentLibraryItems = { value: [] as never };
  const currentRouteItems: { value: unknown[] } = { value: [] };
  const menu: { open: boolean; prevFocus: FocusArea; items: ContextMenuItem[] } = {
    open: false,
    prevFocus: 'sidebar',
    items: [],
  };
  const manualLyricsScroll = { value: false };
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
    visualizerVisible,
    latestVizFrame,
    currentSearchHits: currentSearchHits as unknown as UiCoreContext['currentSearchHits'],
    currentLibraryItems: currentLibraryItems as unknown as UiCoreContext['currentLibraryItems'],
    currentRouteItems,
    manualLyricsScroll,
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

  // Listeners — wire them once with closures over the shared `ctx`.
  built.nav.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, option) => {
    const target = option?.value as Route | undefined;
    if (target) {
      ctx.helpers.showRoute(target);
      ctx.helpers.setFocusArea('main');
    }
  });

  built.searchInput.on(InputRenderableEvents.ENTER, () => {
    const q = built.searchInput.value.trim();
    if (q.length > 0) {
      opts.onSearchSubmit(q);
    }
  });
  built.searchResults.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    const hit = ctx.currentSearchHits.value[idx];
    if (hit && opts.onSelectSearchHit) {
      opts.onSelectSearchHit(hit);
    }
  });
  built.libraryList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    const item = ctx.currentLibraryItems.value[idx];
    if (item && opts.onSelectLibraryItem) {
      opts.onSelectLibraryItem(item);
    }
    opts.onSelectLibrary(idx);
  });
  built.queueList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    opts.onSelectQueue(idx);
  });
  built.artistList.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    const item = ctx.currentRouteItems.value[built.artistList.getSelectedIndex()] as unknown as
      | { id?: string }
      | undefined;
    if (item?.id && opts.onSelectArtistAlbum) {
      opts.onSelectArtistAlbum(item.id);
    }
  });
  const playSelectedEntityTrack = (list: { getSelectedIndex: () => number }): void => {
    const item = ctx.currentRouteItems.value[list.getSelectedIndex()] as unknown as
      | { uri?: string; name?: string }
      | undefined;
    if (item?.uri && opts.onSelectEntityTrack) {
      opts.onSelectEntityTrack(item.uri, item.name ?? item.uri);
    }
  };
  built.albumList.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    playSelectedEntityTrack(built.albumList);
  });
  built.playlistList.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    playSelectedEntityTrack(built.playlistList);
  });
  // Paging trigger: reaching the last row loads the next page in place.
  const watchListEnd = (kind: 'artist' | 'album' | 'playlist', list: AnySelect): void => {
    list.on(SelectRenderableEvents.SELECTION_CHANGED, (idx: number) => {
      if (idx >= list.options.length - 1 && opts.onEntityListEnd) {
        opts.onEntityListEnd(kind);
      }
    });
  };
  watchListEnd('artist', built.artistList);
  watchListEnd('album', built.albumList);
  watchListEnd('playlist', built.playlistList);
  built.paletteInput.on(InputRenderableEvents.CHANGE, (value: string) => {
    ctx.helpers.updatePaletteList(value);
  });
  built.clientIdInput.on(InputRenderableEvents.ENTER, () => {
    const val = built.clientIdInput.value.trim();
    if (val.length > 0) {
      if (opts.onSaveClientId) {
        void opts.onSaveClientId(val);
      }
      built.clientIdInput.value = '';
      built.clientIdInput.blur();
      ctx.helpers.refreshSettings();
    }
  });

  renderer.on('resize', (w: number) => {
    if (w < 80) {
      visualizerVisible.value = false;
    }
    built.right.visible = w >= 80 && visualizerVisible.value;
  });

  // Mount initial state. Unauthenticated boots route straight to the
  // login page without pushing a spurious home entry onto the stack.
  ctx.helpers.showRoute(initial.auth.state === 'authenticated' ? 'home' : 'settings', true, true);
  ctx.helpers.setFocusArea('sidebar');
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
}
