import type { CatalogTrackT } from 'spotoei-protocol';
import { resolveQueueView } from '../queue';
import type { UiOptions } from '../ui/types';
import { handleSearchHitSelect, routeForLibraryItem } from './entitySelect';
import { loadMoreEntityItems, poolTracksForRoute } from './entityLoaders';
import type { AppContext } from './types';
import type { UiInitActions } from './uiActions';

export function createSelectCallbacks(
  ctx: AppContext,
  actions: UiInitActions,
  play: (track: CatalogTrackT) => void,
): Pick<
  UiOptions,
  | 'onSelectSearchHit'
  | 'onSelectLibraryItem'
  | 'onSelectLibrary'
  | 'onSelectArtistAlbum'
  | 'onSelectEntityTrack'
  | 'onEntityListEnd'
  | 'onLibraryListEnd'
  | 'onSelectQueue'
  | 'onSelectHomeRow'
> {
  const { clients, state, getUi } = ctx;
  return {
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
  };
}
