import type { CatalogTrackT, LibraryCollectionT, SearchResponseT } from 'spotoei-protocol';

import { createUi, type Ui } from '../ui';
import type { ContextTarget } from '../ui/types';
import { routeKind } from '../ui/core/navigationStack';
import { resolveQueueView } from '../queue';
import {
  activateBrowseEntry,
  browseEntriesKey,
  ensureBrowseEntry,
  ensureBrowseLevelLive,
  getBrowseTrack,
  getDynamicEntry,
  isBrowseTracksMode,
  resolveBrowseSelection,
} from './browseLoad';
import { runContextAction } from './contextMenuItems';
import { ensureEntityRoute, loadMoreEntityItems, poolTracksForRoute } from './entityLoaders';
import { ensureHomeTab } from './homeLoad';
import type { PlayTrackOpts } from './playback';
import { handleSearchHitSelect, routeForLibraryItem } from './entitySelect';
import { buildPaletteCommands } from './paletteCommands';
import type { AppContext } from './types';
export async function initUi(
  ctx: AppContext,
  actions: {
    triggerAuth: () => Promise<void>;
    triggerLogout: () => Promise<void>;
    handleSaveClientId: (id: string) => Promise<void>;
    loadLibrary: (force?: boolean, collection?: LibraryCollectionT) => Promise<void>;
    loadMoreLibrary?: () => Promise<void>;
    togglePlaylistFolder?: (folderId: string) => void;
    loadCurrentLyrics: (force?: boolean) => Promise<void>;
    updateQueueView: () => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    playRadio?: (opts: { seedUri: string; title?: string }) => Promise<void>;
    playTrackOrContext: (opts: PlayTrackOpts) => Promise<void>;
    nextTrack: () => Promise<void>;
    previousTrack: () => Promise<void>;
    toggleShuffle: () => Promise<void>;
    toggleRepeat: () => Promise<void>;
    toggleAutoplay: () => Promise<void>;
    seekRelative: (deltaMs: number) => Promise<void>;
    changeVolume: (delta: number) => Promise<void>;
    handleKey: (key: Parameters<Parameters<typeof createUi>[1]['onKey']>[0]) => void;
  },
  makeUi: typeof createUi = createUi,
): Promise<Ui> {
  const { clients, state, getUi, quit } = ctx;
  const play = (t: CatalogTrackT) => {
    if (t.uri.startsWith('spotify:album:')) {
      void actions.playTrackOrContext({ contextUri: t.uri, title: t.name });
    } else {
      // A direct play establishes its own queue context so Next continues
      // from here (plus radio) instead of a stale pool head.
      state.activePlaylistTracks = [t];
      void actions.playTrackOrContext({
        trackUri: t.uri,
        title: t.name,
        meta: {
          durationMs: t.durationMs,
          artists: t.artists?.map((a) => a.name) ?? [],
          album: t.albumName,
        },
      });
    }
    void actions.updateQueueView();
    void actions.ensureAutoplayTracks();
  };
  function submitSearch(query: string, label?: string): void {
    const q = query.trim();
    if (!q) return;
    const currentUi = getUi();
    if (currentUi) {
      const ck = `search:v1:${q.toLowerCase().replace(/\s+/g, ' ')}:track,album,artist,playlist`;
      if (
        !clients.cache.tryGetCached<SearchResponseT>(
          (state.currentInfo.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous',
          ck,
        )
      )
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

  const ui = await makeUi(state.currentInfo, {
    onKey: actions.handleKey,
    onAuthenticate: actions.triggerAuth,
    onLogout: actions.triggerLogout,
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
      // Live (dynamic) rows first: they are absent from the static
      // registry, so static resolution would misfire on them.
      const dynamic = getDynamicEntry(browseEntriesKey(path), idx);
      if (dynamic) {
        const nav = activateBrowseEntry(dynamic);
        if (nav.kind === 'message') {
          u?.setStatus(nav.text, nav.persist);
          return;
        }
        u?.setRoute(nav.route);
        if (nav.note) u?.setStatus(nav.note);
        return;
      }
      // Entry inline tracks vs browse sub-route; search never produced here.
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
        void actions.playTrackOrContext({
          trackUri: track.uri,
          title: track.name,
          meta: {
            durationMs: track.durationMs,
            artists: track.artists?.map((a) => a.name) ?? [],
            album: track.albumName,
          },
        });
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      });
      void opened;
    },
    onSelectLibraryItem: (item) => {
      if (
        'children' in item &&
        typeof (item as { isExpanded?: boolean }).isExpanded === 'boolean'
      ) {
        actions.togglePlaylistFolder?.(item.id);
        return;
      }
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
          meta: {
            durationMs: item.durationMs,
            artists: item.artists?.map((a) => a.name) ?? [],
            album: item.albumName,
          },
        });
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      } else {
        void actions.playTrackOrContext({ contextUri: item.uri, title: item.name });
      }
    },
    onSelectLibrary: (_idx) => {},
    onSelectArtistAlbum: (albumId) => {
      getUi()?.setRoute({ kind: 'album', id: albumId });
    },
    onSelectEntityTrack: (trackUri, title) => {
      // Continue inside the visible album/playlist list when available.
      const pool = poolTracksForRoute(state, getUi()?.getRoute());
      if (pool) {
        const idx = pool.findIndex((t) => t.uri === trackUri);
        state.activePlaylistTracks = idx >= 0 ? pool.slice(idx) : pool;
      }
      const matched = pool?.find((t) => t.uri === trackUri);
      void actions.playTrackOrContext({
        trackUri,
        title,
        meta: matched
          ? {
              durationMs: matched.durationMs,
              artists: matched.artists?.map((a) => a.name) ?? [],
              album: matched.albumName,
            }
          : undefined,
      });
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
      // Resolve against the same merged snapshot the view renders,
      // otherwise the selected row maps to the wrong track.
      const snap = resolveQueueView(
        clients.queueManager.getSnapshot(),
        state.activePlaylistTracks,
        state.currentInfo.playback?.track ?? null,
      );
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
          meta: {
            durationMs: item.track.durationMs,
            artists: item.track.artists?.map((a) => a.name) ?? [],
            album: item.track.albumName,
          },
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
        if (state.currentInfo.auth.state === 'authenticated') {
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
      if (curKind === 'settings') {
        void clients.playback
          .getAudioConfig()
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
          })
          .catch(() => {});
      }
      if (curKind === 'artist' || curKind === 'album' || curKind === 'playlist') {
        void ensureEntityRoute({ entityManager: clients.entityManager, getUi, state }, route);
      }
      if (curKind === 'browse' && route.kind === 'browse') {
        const u = getUi();
        if (!u) return;
        const path = route.path ?? {};
        if (path.entry) {
          void ensureBrowseEntry(u, path, {
            entityManager: clients.entityManager,
            searchClient: clients.searchClient,
          });
        } else {
          // Live Spotify categories first, offline registry on restriction.
          const accountId =
            (state.currentInfo.auth as { accountId?: string } | undefined)?.accountId ??
            'anonymous';
          void ensureBrowseLevelLive(u, path, clients.webApi, clients.cache, accountId);
        }
      }
    },
    onSaveClientId: actions.handleSaveClientId,
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

  const contextDeps = {
    ...ctx,
    contextActions: {
      playTrackOrContext: actions.playTrackOrContext,
      updateQueueView: actions.updateQueueView,
      ensureAutoplayTracks: actions.ensureAutoplayTracks,
      playRadio: actions.playRadio,
    },
  };
  const runPaletteAction = (action: string, target: ContextTarget): void => {
    void runContextAction(contextDeps, getUi, action, target);
  };

  ui.setPaletteCommands(
    buildPaletteCommands(ctx, { ...actions, cycleVisualizerMode }, getUi, quit, {
      getTarget: () => getUi()?.getContextTarget() ?? null,
      run: runPaletteAction,
      notify: (msg) => getUi()?.setStatus(msg),
    }),
  );

  // The initial route callback runs before ctx.getUi exists.
  if (state.currentInfo.auth.state === 'authenticated') {
    void ensureHomeTab(
      {
        homeManager: clients.homeManager,
        entityManager: clients.entityManager,
        getUi: () => ui,
        state,
      },
      state.homeTabs.activeTab,
    );
  }
  return ui;
}
