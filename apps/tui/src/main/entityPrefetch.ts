// @ts-nocheck
import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import { fetchAllPages } from '../webApi/paging';
import { type EntityLoaderDeps, loadingMore, PREFETCH_PARALLEL, pagesOf } from './entityPages';

// Fetch every remaining page in the background (8-parallel, like
// spotify-player's `all_paging_items`) and append it to the already
// painted first page. Best-effort: failures stay silent because the
// first page is already visible and `hasMore` keeps manual paging alive.
export function prefetchRemaining(
  deps: EntityLoaderDeps,
  kind: 'artist' | 'album' | 'playlist',
  id: string,
  group: string,
  pageSize: number,
  total: number,
): void {
  const { entityManager, getUi, state } = deps;
  const key = kind === 'artist' ? `artist:${id}:${group}` : `${kind}:${id}`;
  if (loadingMore.has(key)) return;
  loadingMore.add(key);
  void (async () => {
    try {
      const pages = pagesOf(state);
      const prev = pages[key];
      if (!prev || !prev.hasMore) return;
      const loadPage = async (offset: number) => {
        if (kind === 'artist') {
          const page = await entityManager.loadArtistAlbums(id, group, offset, pageSize);
          return { items: page.items, total: page.total };
        }
        if (kind === 'album') {
          const page = await entityManager.loadAlbumTracks(id, offset, pageSize);
          return { items: page.items, total: page.total };
        }
        const page = await entityManager.loadPlaylistTracks(id, offset, pageSize);
        return { items: page.items, total: page.total };
      };
      const rest = await fetchAllPages(loadPage, {
        startOffset: prev.nextOffset,
        pageLimit: pageSize,
        maxParallel: PREFETCH_PARALLEL,
        knownTotal: total,
      });
      if (rest.items.length === 0) {
        const cur = pagesOf(state)[key];
        if (cur) cur.hasMore = false;
        return;
      }
      const cur = pagesOf(state)[key];
      const merged = [...(cur?.items ?? prev.items), ...rest.items];
      pagesOf(state)[key] = {
        items: merged,
        nextOffset: prev.nextOffset + rest.items.length,
        hasMore: false,
        group: prev.group,
      };
      const ui = getUi();
      const route = ui?.getRoute?.() as { kind?: string; id?: string } | undefined;
      // Paint only onto the route that requested the data; a missing
      // route (tests) still paints, like the initial page does.
      const foreign = route && (route.kind !== kind || route.id !== id);
      if (!ui || foreign) {
        return;
      }
      const fresh = rest.items;
      if (kind === 'artist') ui.setArtistAlbums(fresh as CatalogAlbumT[], { append: true });
      else if (kind === 'album') ui.setAlbumTracks(fresh as CatalogTrackT[], { append: true });
      else ui.setPlaylistTracks(fresh as CatalogTrackT[], { append: true });
    } catch {
      // Silent: the first page is already painted; manual paging retries.
    } finally {
      loadingMore.delete(key);
    }
  })();
}
