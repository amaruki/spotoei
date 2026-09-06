// Shared mutable state bag passed between the core controller and its
// helper sub-modules. Using a single context (instead of closures) lets
// us split `createUiCore` across files without sacrificing the shared
// mutable state the original single-function implementation relied on.

import type { CliRenderer, SelectRenderable } from '@opentui/core';
import type {
  LyricsDocumentT,
  PlaybackChangedDataT,
  SearchHitT,
  VisualizerModeT,
} from 'spotoei-protocol';

import type { ViewPositionStore } from '../../navigation/viewPositions';
import type { BuiltUi } from '../componentTree';
import type { TimeRangeT } from 'spotoei-protocol';
import type {
  ContextMenuItem,
  FocusArea,
  KeyDispatch,
  LibraryItemT,
  Route,
  Ui,
  UiOptions,
  UiViewState,
  VisualizerFrame,
} from '../types';
import type { HomeRow } from '../views/homeRows';

export interface UiCoreContext {
  renderer: CliRenderer;
  state: UiViewState;
  opts: UiOptions;
  built: BuiltUi;
  route: { current: Route };
  routeStack: Route[];
  positions: ViewPositionStore;
  focus: { current: FocusArea };
  termWidth: { value: number };
  sidebarPinned: { value: boolean };
  latestVizFrame: { value: VisualizerFrame | null };
  currentLibraryItems: { value: LibraryItemT[] };
  currentSearchHits: { value: SearchHitT[] };
  lastSearch: { value: import('spotoei-protocol').SearchResponseT | null };
  searchFilter: { current: import('../views/search').SearchFilter };
  currentRouteItems: { value: unknown[] };
  currentHomeItems: { value: HomeRow[] };
  homeRange: { current: TimeRangeT };
  homePanel: { value: number };
  searchPanel: { value: number };
  searchPanelMaps: {
    value: { tracks: number[]; artists: number[]; albums: number[]; playlists: number[] };
  };
  manualLyricsScroll: { value: boolean };
  lyricsResumeTimer: { value: ReturnType<typeof setTimeout> | null };
  drawerOpen: { value: boolean };
  libraryHasMore: { value: boolean | undefined };
  menu: {
    open: boolean;
    prevFocus: FocusArea;
    items: ContextMenuItem[];
  };
  palette: {
    commands: Array<{ name: string; description: string; action: () => void; isAvailable?: () => boolean }>;
    filtered: Array<{ name: string; description: string; action: () => void; isAvailable?: () => boolean }>;
    open: boolean;
    prevFocus: FocusArea;
  };
  statusTimer: { value: ReturnType<typeof setTimeout> | null };
  // cross-references set up by helpers so listeners can call them
  helpers: {
    getFooterHelp: () => string;
    setStatus: (msg: string, persist?: boolean) => void;
    clearStatusLayer: () => void;
    refreshNav: () => void;
    setNavSelected: (target: Route) => void;
    showRoute: (next: Route | string, force?: boolean, replace?: boolean) => void;
    navigateBack: () => boolean;
    setFocusArea: (next: FocusArea) => void;
    toggleSidebar: () => void;
    updateFocusVisuals: () => void;
    updateSearchFocusVisuals: (inputFocused: boolean) => void;
    refreshHome: () => void;
    refreshSettings: () => void;
    refreshOnboarding: () => void;
    renderPlaybackBar: () => void;
    setHeader: () => void;
    setVizTitle: () => void;
    paintViz: () => void;
    setPaletteOpen: (open: boolean) => void;
    updatePaletteList: (filter: string) => void;
    openContextMenu: (title: string, items: ContextMenuItem[]) => void;
    closeContextMenu: () => void;
    isContextMenuOpen: () => boolean;
    runMenuSelected: () => void;
    getActiveList: () => AnySelect | null;
    moveActiveList: (delta: number) => boolean;
    jumpActiveList: (to: 'top' | 'bottom', targetIndex?: number) => boolean;
  };
}

// Convenience type for the many SelectRenderable references we keep in `built`.
export type AnySelect = SelectRenderable;

// Re-exports for the rest of the controller. Keeping them here so consumers
// of the core modules don't have to reach into the protocol package twice.
export type {
  FocusArea,
  KeyDispatch,
  LibraryItemT,
  LyricsDocumentT,
  PlaybackChangedDataT,
  Route,
  SearchHitT,
  Ui,
  UiOptions,
  UiViewState,
  VisualizerFrame,
  VisualizerModeT,
};
