import type { CatalogTrackT } from 'spotoei-protocol';

import { createUi, type Ui } from '../ui';
import { routeKind } from '../ui/core/navigationStack';
import { handleSearchHitSelect, routeForLibraryItem } from './entitySelect';
import { buildPaletteCommands } from './paletteCommands';
import type { AppContext } from './types';
export async function initUi(
  ctx: AppContext,
  actions: {
    triggerAuth: () => Promise<void>;
    handleSaveClientId: (id: string) => Promise<void>;
    loadLibrary: (force?: boolean) => Promise<void>;
    loadCurrentLyrics: (force?: boolean) => Promise<void>;
    updateQueueView: () => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    playTrackOrContext: (opts: {
      trackUri?: string;
      contextUri?: string;
      title: string;
    }) => Promise<void>;
    nextTrack: () => Promise<void>;
    previousTrack: () => Promise<void>;
    toggleShuffle: () => Promise<void>;
    toggleRepeat: () => Promise<void>;
    toggleAutoplay: () => Promise<void>;
    seekRelative: (deltaMs: number) => Promise<void>;
    changeVolume: (delta: number) => Promise<void>;
    handleKey: (key: Parameters<Parameters<typeof createUi>[1]['onKey']>[0]) => void;
  },
): Promise<Ui> {
  const { clients, state, getUi, quit } = ctx;

  const ui = await createUi(state.currentInfo, {
    onKey: actions.handleKey,
    onSearchSubmit: (q) => {
      const query = q.trim();
      if (!query) return;
      const currentUi = getUi();
      if (currentUi) {
        currentUi.setSearchLoading(true);
        currentUi.setStatus(`Searching Spotify for "${query}"…`);
      }
      const seq = ++state.searchSequence;
      clients.searchClient
        .search(query)
        .then((res) => {
          if (seq === state.searchSequence) {
            const u = getUi();
            if (u) {
              u.setSearchLoading(false);
              u.setSearchResults(query, res);
              state.currentSearchHits = res.hits;
              const count = res.hits.length;
              u.setStatus(
                count > 0
                  ? `Found ${count} result${count === 1 ? '' : 's'} for "${query}". Press Enter to play.`
                  : `No results found for "${query}".`,
              );
            }
          }
        })
        .catch((e: unknown) => {
          if (seq === state.searchSequence) {
            const u = getUi();
            if (u) {
              u.setSearchLoading(false);
              const msg = e instanceof Error ? e.message : String(e);
              u.setStatus(`Search error: ${msg}`, true);
              u.setSearchResults(query, {
                query,
                hits: [],
                error: { code: 'SEARCH_ERROR', message: msg },
              });
            }
          }
        });
    },
    onSelectSearchHit: (hit) => {
      const opened = handleSearchHitSelect(hit, getUi(), (track) => {
        if (state.currentSearchHits.length > 0) {
          state.activePlaylistTracks = state.currentSearchHits
            .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
            .map((h) => h.track);
        }
        void actions.playTrackOrContext({ trackUri: track.uri, title: track.name });
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      });
      void opened;
    },
    onSelectLibraryItem: (item) => {
      const route = routeForLibraryItem(item);
      if (route) {
        getUi()?.setRoute(route);
        return;
      }
      const isTrackLike = 'durationMs' in item;
      if (isTrackLike) {
        state.activePlaylistTracks = state.libraryItems.filter(
          (libItem) => 'durationMs' in libItem,
        ) as unknown as CatalogTrackT[];
        void actions.playTrackOrContext({
          trackUri: item.uri,
          title: item.name,
        });
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      } else {
        void actions.playTrackOrContext({ contextUri: item.uri, title: item.name });
      }
    },
    onSelectLibrary: (_idx) => {
      // Playback is handled by onSelectLibraryItem
    },
    onSelectQueue: (idx) => {
      const snap = clients.queueManager.getSnapshot();
      const hasCurrent = Boolean(snap.current);
      const item = hasCurrent
        ? idx === 0 && snap.current
          ? { track: snap.current }
          : snap.upcoming[idx - 1]
        : snap.upcoming[idx];
      if (item) {
        void actions.playTrackOrContext({
          trackUri: item.track.uri,
          title: item.track.name,
        });
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      }
    },
    onRouteChange: (route) => {
      const curKind = routeKind(route);
      if (curKind === 'library' && state.libraryItems.length === 0) {
        void actions.loadLibrary();
      }
      if (curKind === 'queue') {
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      }
      if (curKind === 'lyrics') {
        void actions.loadCurrentLyrics();
      }
    },
    onSaveClientId: actions.handleSaveClientId,
    onAuthenticate: actions.triggerAuth,
    onCycleVisualizerMode: cycleVisualizerMode,
  });

  function cycleVisualizerMode(): void {
    const next = clients.visualizer.cycleMode();
    state.currentInfo.visualizer = { mode: next, fps: clients.visualizer.getCurrentFps() };
    const u = getUi();
    if (u) {
      u.setVisualizerFrame(null);
      u.setStatus(`Visualizer mode: ${next}`);
    }
  }

  // Palette command list (split for LoC cap; behavior unchanged)
  ui.setPaletteCommands(
    buildPaletteCommands(ctx, { ...actions, cycleVisualizerMode }, getUi, quit),
  );

  return ui;
}
