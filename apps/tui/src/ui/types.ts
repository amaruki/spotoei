// Shared types for the OpenTUI renderer. Everything that crosses the
// `createUiCore` boundary lives here so callers can import it from the
// `./ui` shim without reaching into internal sub-modules.

import type {
  AuthStatusDataT,
  LyricsDocumentT,
  PlaybackChangedDataT,
  PlaybackPositionDataT,
  QueueSnapshotT,
  RouteT,
  SearchHitT,
  SearchResponseT,
  VisualizerModeT,
} from 'spotoei-protocol';
export type FocusArea = 'sidebar' | 'main';

export interface LibraryItemT {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id?: string; name: string; uri?: string }>;
  albumId?: string;
  albumName?: string;
  durationMs?: number;
  image?: { url: string; width?: number; height?: number };
  isExplicit?: boolean;
  isPlayable?: boolean;
}
// Legacy string-typed Route kept as a transitional alias for callers that
// compare routes by kind only. New code should use `RouteT` directly.
export type Route = RouteT;
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
  mode: 'off' | VisualizerModeT;
  bands?: number[];
  maxBands?: number[];
  rms?: number;
  peak?: number;
  fps?: number;
  data?: Uint8Array | number[];
}

export type KeyDispatch = (key: {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  raw: string;
}) => void;

export interface Ui {
  navigateBack(): boolean;
  getRouteStack(): Route[];
  setRoute(next: Route | string): void;
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
