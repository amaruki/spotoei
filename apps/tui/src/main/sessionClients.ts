import type { ChildProcess } from 'node:child_process';
import type { AuthStatusDataT, PlaybackChangedDataT } from 'spotoei-protocol';

import { createAuthClient } from '../auth';
import { Cache } from '../cache';
import { diagnostic } from '../diagnostics';
import { EntityManager } from '../entities';
import { HomeManager } from '../home';
import { initialHomeTabs } from '../home/tabs';
import { LibraryManager } from '../library';
import { createLyricsClient } from '../lyrics';
import { createPlaybackClient } from '../playback';
import type { HandshakeResult } from '../player/types';
import { QueueManager } from '../queue';
import { createSearchClient } from '../search';
import type { UiViewState } from '../ui';
import { createVisualizerController } from '../visualizer';
import { WebApiClient } from '../webApi';
import type { AppClients, AppState } from './types';

export interface SessionClientBundle {
  clients: AppClients;
  currentInfo: UiViewState;
  state: AppState;
  initialAuth: AuthStatusDataT;
  initialPlayback: PlaybackChangedDataT;
  setActiveAccountId: (accountId: string) => void;
}

// Build the sidecar clients and initial app state. Kept apart from the
// session orchestration in index.ts so both stay under the LoC ceiling.
export async function createSessionClients(
  child: ChildProcess,
  handshake: HandshakeResult,
  cleanup: Array<() => void>,
  setStage: (stage: string) => void,
): Promise<SessionClientBundle> {
  const auth = createAuthClient({ child });
  const playback = createPlaybackClient({ child });
  cleanup.push(
    () => auth.close(),
    () => playback.close(),
  );
  setStage('auth.status');
  const initialAuth = await auth.status();
  diagnostic('ipc', 'auth.status', { state: initialAuth.state, scopes: initialAuth.scopes });
  setStage('playback.status');
  const initialPlayback = await playback.status();

  const cache = new Cache();
  cleanup.push(() => cache.close());
  let activeAccountId = initialAuth.accountId ?? 'anonymous';
  const tokenProvider = {
    async getAccessToken(): Promise<string> {
      return auth.getWebToken();
    },
    invalidateToken(): Promise<void> {
      return auth.invalidateToken();
    },
  };
  const webApi = new WebApiClient({
    tokenProvider,
    restrictionStore: {
      // Restriction memory persists in SQLite so a cold start skips
      // endpoints Spotify already refused, instead of re-probing them.
      // getQuery prunes expired rows on read; failures fall back to
      // the Transport's in-memory map.
      getRestriction: (endpoint: string): number | undefined => {
        try {
          const cached = cache.getQuery<number>(activeAccountId, `restriction:v1:${endpoint}`);
          if (!cached || cached.expiresAt === null || Date.now() >= cached.expiresAt) {
            return undefined;
          }
          return cached.expiresAt;
        } catch {
          return undefined;
        }
      },
      setRestriction: (endpoint: string, until: number): void => {
        try {
          cache.putQuery(activeAccountId, `restriction:v1:${endpoint}`, 1, until - Date.now());
        } catch {
          // Non-fatal; the in-memory map still suppresses repeats.
        }
      },
    },
  });
  const searchClient = createSearchClient({
    webApi,
    cache,
    accountId: initialAuth.accountId ?? 'anonymous',
    debounceMs: 0,
  });
  const libraryManager = new LibraryManager({
    webApi,
    cache,
    accountId: initialAuth.accountId ?? 'anonymous',
  });
  const entityManager = new EntityManager(webApi, cache, initialAuth.accountId ?? 'anonymous');
  const homeManager = new HomeManager(webApi, cache, initialAuth.accountId ?? 'anonymous');
  const queueManager = new QueueManager({ webApi });
  const visualizer = createVisualizerController({ child });
  const lyrics = createLyricsClient({ child });
  cleanup.push(
    () => searchClient.close(),
    () => visualizer.stop(),
    () => lyrics.close(),
  );

  const clients: AppClients = {
    auth,
    playback,
    webApi,
    searchClient,
    entityManager,
    homeManager,
    libraryManager,
    queueManager,
    visualizer,
    lyrics,
    cache,
  };

  const currentInfo: UiViewState = {
    protocol: handshake.protocol,
    playerVersion: handshake.playerVersion,
    capabilities: handshake.capabilities,
    auth: initialAuth,
    playback: initialPlayback,
    queue: {
      current: null,
      upcoming: [],
      revision: 0,
    },
    visualizer: {
      mode: visualizer.getMode(),
      fps: visualizer.getCurrentFps(),
    },
    audioConfig: {
      deviceMode: 'integrated',
      audioBackend: 'rodio',
      bitrate: '320',
      crossfadeDurationMs: 0,
      normalisation: true,
      pregain: 0,
    },
  };

  const state: AppState = {
    currentInfo,
    activeFocus: 'main',
    libraryItems: [],
    librarySection: 'saved_tracks',
    entityPages: {},
    homeTabs: initialHomeTabs(),
    activePlaylistTracks: [],
    currentSearchHits: [],
    artistGenreCache: new Map(),
    currentLyricsTrackUri: undefined,
    lastRouteBeforeLyrics: { kind: 'home', tab: 'for_you' },
    searchSequence: 0,
    isFetchingAutoplay: false,
    isAdvancingAutoplay: false,
    lastPlaybackState: initialPlayback?.state ?? 'idle',
  };

  const setActiveAccountId = (accountId: string): void => {
    activeAccountId = accountId;
  };

  return { clients, currentInfo, state, initialAuth, initialPlayback, setActiveAccountId };
}
