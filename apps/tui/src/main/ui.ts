import type { CatalogTrackT, LibraryCollectionT } from 'spotoei-protocol';

import { createUi, type Ui } from '../ui';
import type { ContextTarget } from '../ui/types';
import { routeKind } from '../ui/core/navigationStack';
import { ensureBrowseEntry, ensureBrowseLevel, getBrowseTrack, isBrowseTracksMode, resolveBrowseSelection } from './browseLoad';
import { runContextAction } from './contextMenuItems';
import { ensureEntityRoute, loadMoreEntityItems } from './entityLoaders';
import { ensureHomeTab } from './homeLoad';
import { handleSearchHitSelect, routeForLibraryItem } from './entitySelect';
import { buildPaletteCommands } from './paletteCommands';
import type { AppContext } from './types';
export async function initUi(
  ctx: AppContext,
  actions: {
    triggerAuth: () => Promise<void>;
    handleSaveClientId: (id: string) => Promise<void>;
    loadLibrary: (
      force?: boolean,
      collection?: LibraryCollectionT,
    ) => Promise<void>;
    loadMoreLibrary?: () => Promise<void>;
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
  const play = (t: CatalogTrackT) => {
    const isAlbum = t.uri.startsWith('spotify:album:');
    if (isAlbum) void actions.playTrackOrContext({ contextUri: t.uri, title: t.name });
    else void actions.playTrackOrContext({ trackUri: t.uri, title: t.name });
    void actions.updateQueueView();
    void actions.ensureAutoplayTracks();
  };
  function submitSearch(query: string, label?: string): void {
    const q = query.trim();
    if (!q) return;
    const currentUi = getUi();
    if (currentUi) {
      currentUi.setSearchLoading(true);
      currentUi.setStatus(label ?? `Searching Spotify for "${q}"…`);
    }
    const seq = ++state.searchSequence;
    clients.searchClient
      .search(q)
      .then((res) => {
        if (seq === state.searchSequence) {
          const u = getUi();
          if (u) {
            u.setSearchLoading(false);
            u.setSearchResults(q, res);
            state.currentSearchHits = res.hits;
            const count = res.hits.length;
            u.setStatus(
              count > 0
                ? `Found ${count} result${count === 1 ? '' : 's'} for "${q}". Press Enter to play.`
                : `No results found for "${q}".`,
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
            u.setSearchResults(q, {
              query: q,
              hits: [],
              error: { code: 'SEARCH_ERROR', message: msg },
            });
          }
        }
      });
  }

  const ui = await createUi(state.currentInfo, {
    onKey: actions.handleKey,
    onSearchSubmit: (q) => submitSearch(q),
    onSelectBrowseEntry: async (idx) => {
      const u = getUi();
      const r = u?.getRoute();
      if (!r || r.kind !== 'browse') return;
      if (isBrowseTracksMode()) {
        const t = getBrowseTrack(idx);
        if (t) play(t);
        return;
      }
      const path = r.path ?? {};
      // Entry-level inline kinds (new_releases/recommendations) render
      // tracks without pushing a route; everything else resolves to a
      // browse sub-route (entry level) or a foreign route. Search routes
      // are never produced here — browse results stay in Browse.
      if (!path.category) {
        const nav = resolveBrowseSelection(path, idx);
        if (nav.kind === 'message') {
          u?.setStatus(nav.text, nav.persist);
          return;
        }
        u?.setRoute(nav.route);
        if (nav.note) u?.setStatus(nav.note);
        return;
      }
      const nav = resolveBrowseSelection(path, idx);
      if (nav.kind === 'message') {
        u?.setStatus(nav.text, nav.persist);
        return;
      }
      u?.setRoute(nav.route);
      if (nav.note) u?.setStatus(nav.note);
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
    onSelectArtistAlbum: (albumId) => {
      getUi()?.setRoute({ kind: 'album', id: albumId });
    },
    onSelectEntityTrack: (trackUri, title) => {
      void actions.playTrackOrContext({ trackUri, title });
      void actions.updateQueueView();
      void actions.ensureAutoplayTracks();
    },
    onEntityListEnd: (kind) => {
      const u = getUi();
      const r = u?.getRoute();
      if (r && r.kind === kind && 'id' in r && typeof r.id === 'string') {
        void loadMoreEntityItems(
          { entityManager: clients.entityManager, getUi, state },
          kind,
          r.id,
        );
      }
    },
    onLibraryListEnd: () => {
      const fn = actions.loadMoreLibrary;
      if (fn) void fn();
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
    onSelectHomeRow: (row) => {
      if (row.kind === 'track') play(row.track);
      else if (row.kind === 'artist') getUi()?.setRoute({ kind: 'artist', id: row.artist.id });
      else if (row.kind === 'discover') {
        const maybeTrack = (row as { track?: CatalogTrackT }).track;
        if (maybeTrack) play(maybeTrack as CatalogTrackT);
        else getUi()?.setRoute({ kind: 'browse', path: { category: row.id } });
      }
    },
    onRouteChange: (route) => {
      const curKind = routeKind(route);
      if (curKind === 'home' && route.kind === 'home') {
        state.homeTabs.activeTab = route.tab;
        void ensureHomeTab(
          {
            homeManager: clients.homeManager,
            entityManager: clients.entityManager,
            getUi,
            state,
          },
          route.tab,
        );
      }
      if (curKind === 'library') {
        const section = route.kind === 'library' ? route.section : state.librarySection;
        if (state.libraryItems.length === 0 || state.librarySection !== section) {
          state.librarySection = section;
          state.libraryItems = [];
          void actions.loadLibrary(false, section);
        }
      }
      if (curKind === 'queue') {
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      }
      if (curKind === 'lyrics') {
        void actions.loadCurrentLyrics();
      }
      if (curKind === 'artist' || curKind === 'album' || curKind === 'playlist') {
        void ensureEntityRoute({ entityManager: clients.entityManager, getUi, state }, route);
      }
      if (curKind === 'browse' && route.kind === 'browse') {
        const u = getUi();
        if (!u) return;
        const path = route.path ?? {};
        if (path.entry) {
          void ensureBrowseEntry(
            u,
            path,
            { entityManager: clients.entityManager, searchClient: clients.searchClient },
          );
        } else {
          ensureBrowseLevel(u, path);
        }
      }
    },
    onSaveClientId: actions.handleSaveClientId,
    onAuthenticate: actions.triggerAuth,
    onCycleVisualizerMode: cycleVisualizerMode,
  });

  function cycleVisualizerMode(): void {
    // Single mode path: the controller owns spectrum/winamp/oscilloscope
    // cycling; the TUI only syncs state and repaints the fullscreen title.
    const next = clients.visualizer.cycleMode();
    state.currentInfo.visualizer = { mode: next, fps: clients.visualizer.getCurrentFps() };
    const u = getUi();
    if (u) {
      u.setVisualizerFrame(null);
      u.setStatus(`Visualizer mode: ${next}`);
    }
  }

  const contextDeps = {
    ...ctx,
    contextActions: {
      playTrackOrContext: actions.playTrackOrContext,
      updateQueueView: actions.updateQueueView,
      ensureAutoplayTracks: actions.ensureAutoplayTracks,
    },
  };
  const runPaletteAction = (action: string, target: ContextTarget): void => {
    void runContextAction(contextDeps, getUi, action, target);
  };

  // Palette command list (split for LoC cap); context entries resolve the
  // live selection and run through the shared runner.
  ui.setPaletteCommands(
    buildPaletteCommands(ctx, { ...actions, cycleVisualizerMode }, getUi, quit, {
      getTarget: () => getUi()?.getContextTarget() ?? null,
      run: runPaletteAction,
      notify: (msg) => getUi()?.setStatus(msg),
    }),
  );

  return ui;
}
