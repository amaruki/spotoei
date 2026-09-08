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
  // True while an audio-streaming login (Step 2/2) waits in the browser.
  // Pure display state: set after beginStreaming, cleared on completion,
  // failure, or logout.
  streamingPending?: boolean;
  lyrics?: LyricsDocumentT;
  statusMessage?: string;
  isPrivateSession?: boolean;
  audioConfig?: UiAudioConfig;
}

export interface UiAudioConfig {
  deviceMode?: string;
  audioBackend?: string;
  bitrate?: string;
  crossfadeDurationMs?: number;
  normalisation?: boolean;
  pregain?: number;
  cachePath?: string;
  cacheSizeMb?: number;
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
  artistUri?: string;
  artistName?: string;
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
  setLibraryItems(
    items: LibraryItemT[],
    error?: { code: string; message: string },
    opts?: { append?: boolean; isStale?: boolean; hasMore?: boolean },
  ): void;
  setLibraryLoading(loading: boolean): void;
  setLibraryLines(lines: string[], empty: boolean): void;
  setQueueSnapshot(snap: QueueSnapshotT, opts?: { isStale?: boolean }): void;
  setHomeItems(
    rows: HomeRow[],
    meta?: { error?: string; rangeLabel?: string; isStale?: boolean },
  ): void;
  setArtistAlbums(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      releaseDate?: string;
    }>,
    opts?: { append?: boolean; isStale?: boolean },
  ): void;
  setAlbumTracks(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      durationMs: number;
    }>,
    opts?: { append?: boolean; isStale?: boolean },
  ): void;
  setPlaylistTracks(
    items: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string; uri?: string }>;
      durationMs: number;
    }>,
    opts?: { append?: boolean; isStale?: boolean },
  ): void;
  setAlbumHeader(album: { name: string; artists: Array<{ name: string }> } | null): void;
  setPlaylistHeader(playlist: { name: string; owner?: { displayName?: string } } | null): void;
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
  setBrowseTracks(
    tracks: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ name: string }>;
      durationMs?: number;
    }>,
  ): void;
  setBrowseBanner(banner: string | null): void;
  setLyrics(doc: LyricsDocumentT | null): void;
  setSearchLoading(loading: boolean): void;
  setPaletteCommands(
    cmds: Array<{
      name: string;
      description: string;
      action: () => void;
      isAvailable?: () => boolean;
    }>,
  ): void;
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
  setStreamingPending(pending: boolean): void;
  focusClientIdInput(): void;
  isAnyInputFocused(): boolean;
  setAudioConfig(config: Partial<UiAudioConfig>): void;
  setPrivateSession?(active: boolean): void;
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
  onLibraryListEnd?: () => void;
  onSelectHomeRow?: (row: HomeRow) => void;
  onSelectBrowseEntry?: (index: number) => void;
  onSaveClientId?: (clientId: string) => void | Promise<void>;
  onAuthenticate?: () => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onRouteChange?: (route: Route) => void;
  onCycleVisualizerMode?: () => void;
  vimTimeoutMs?: number;
}
