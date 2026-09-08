import type { ChildProcess } from 'node:child_process';
import type {
  CatalogTrackT,
  LibraryCollectionT,
  PlaybackChangedDataT,
  SearchResponseT,
} from 'spotoei-protocol';

import type { createAuthClient } from '../auth';
import type { Cache } from '../cache';
import type { EntityManager } from '../entities';
import type { HomeManager } from '../home';
import type { HomeTabState } from '../home/tabs';
import type { LibraryManager } from '../library';
import type { createLyricsClient } from '../lyrics';
import type { createPlaybackClient } from '../playback';
import type { QueueManager } from '../queue';
import type { createSearchClient } from '../search';
import type { FocusArea, LibraryItemT, Route, Ui, UiViewState } from '../ui';
import type { createVisualizerController } from '../visualizer';
import type { WebApiClient } from '../webApi';

export interface Deferred<T> {
  promise: Promise<T>;
  trigger: (val: T) => void;
}

export interface AppClients {
  auth: ReturnType<typeof createAuthClient>;
  playback: ReturnType<typeof createPlaybackClient>;
  webApi: WebApiClient;
  searchClient: ReturnType<typeof createSearchClient>;
  entityManager: EntityManager;
  homeManager: HomeManager;
  libraryManager: LibraryManager;
  queueManager: QueueManager;
  visualizer: ReturnType<typeof createVisualizerController>;
  lyrics: ReturnType<typeof createLyricsClient>;
  cache: Cache;
}

export interface AppState {
  currentInfo: UiViewState;
  activeFocus: FocusArea;
  libraryItems: LibraryItemT[];
  librarySection: LibraryCollectionT;
  entityPages: Record<
    string,
    { items: unknown[]; nextOffset: number; hasMore: boolean; group: string }
  >;
  homeTabs: HomeTabState;
  activePlaylistTracks: CatalogTrackT[];
  currentSearchHits: SearchResponseT['hits'];
  artistGenreCache: Map<string, string>;
  currentLyricsTrackUri?: string;
  lastRouteBeforeLyrics: Route;
  searchSequence: number;
  isFetchingAutoplay: boolean;
  isAdvancingAutoplay: boolean;
  lastPlaybackState: PlaybackChangedDataT['state'];
  isPrivateSession?: boolean;
  hasStreaming?: boolean;
}

export interface AppContext {
  clients: AppClients;
  state: AppState;
  child: ChildProcess;
  getUi: () => Ui | null;
  quit: () => Promise<void>;
}
