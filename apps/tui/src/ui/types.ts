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
import type { HomeRow } from './views/homeRows';
import type { SearchFilter } from './views/search';
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

export type ContextTargetKind = 'track' | 'artist' | 'album' | 'playlist' | 'browse-entry';

export interface ContextTarget {
  kind: ContextTargetKind;
  id: string;
  uri?: string;
  name: string;
}

export interface ContextMenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  reason?: string;
  run: () => void;
}

export interface Ui {
  navigateBack(): boolean;
  toggleSidebar(): void;
  getRouteStack(): Route[];
  setRoute(next: Route | string): void;
  getRoute(): Route;
  setFocus(next: FocusArea): void;
  getFocus(): FocusArea;
  setStatus(msg: string, persist?: boolean): void;
  setVisualizerFrame(frame: VisualizerFrame | null): void;
  setSearchResults(query: string, results: SearchResponseT): void;
  setSearchFilter(filter: SearchFilter): void;
  setLibraryItems(items: LibraryItemT[], error?: { code: string; message: string }): void;
  setLibraryLoading(loading: boolean): void;
  setLibraryLines(lines: string[], empty: boolean): void;
  setQueueSnapshot(snap: QueueSnapshotT): void;
  setHomeItems(rows: HomeRow[], meta?: { error?: string }): void;
  setArtistAlbums(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      releaseDate?: string;
    }>,
    opts?: { append?: boolean },
  ): void;
  setAlbumTracks(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      durationMs: number;
    }>,
    opts?: { append?: boolean },
  ): void;
  setPlaylistTracks(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      durationMs: number;
    }>,
    opts?: { append?: boolean },
  ): void;
  setBrowseCategories(cats: Array<{ id: string; label: string; entries: unknown[] }>): void;
  setBrowseEntries(
    entries: Array<{
      id: string;
      label: string;
      description: string;
      enabled: boolean;
      source: unknown;
    }>,
  ): void;
  setLyrics(doc: LyricsDocumentT | null): void;
  setSearchLoading(loading: boolean): void;
  setPaletteCommands(cmds: Array<{ name: string; description: string; action: () => void }>): void;
  openPalette(): void;
  closePalette(): void;
  isPaletteOpen(): boolean;
  openContextMenu(title: string, items: ContextMenuItem[]): void;
  closeContextMenu(): void;
  isContextMenuOpen(): boolean;
  getContextTarget(): ContextTarget | null;
  setPlayback(playback: PlaybackChangedDataT | null): void;
  setPlaybackPosition(pos: PlaybackPositionDataT): void;
  setAuth(auth: AuthStatusDataT): void;
  focusClientIdInput(): void;
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
  onSelectArtistAlbum?: (albumId: string) => void;
  onSelectEntityTrack?: (trackUri: string, title: string) => void;
  onEntityListEnd?: (kind: 'artist' | 'album' | 'playlist') => void;
  onSelectHomeRow?: (row: HomeRow) => void;
  onSelectBrowseEntry?: (index: number) => void;
  onSaveClientId?: (clientId: string) => void | Promise<void>;
  onAuthenticate?: () => void | Promise<void>;
  onRouteChange?: (route: Route) => void;
  onCycleVisualizerMode?: () => void;
}
