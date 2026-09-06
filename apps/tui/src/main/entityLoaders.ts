// @ts-nocheck
import type { ArtistReleaseGroupT, CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import type { Ui } from '../ui/types';
import { fetchAllPages } from '../webApi/paging';
import type { AppState } from './types';

const PAGE_SIZE = 20;
// Spotify caps artist-albums pages at 10 (limit > 10 → 400 "Invalid limit").
const ARTIST_PAGE_SIZE = 10;
// Parallel background fetch width, mirroring spotify-player's MAX_PARALLEL.
const PREFETCH_PARALLEL = 8;

export interface EntityLoaderDeps {
  entityManager: EntityManager;
  getUi: () => Ui | null;
  state: AppState;
}

interface LoadedPage {
  items: unknown[];
  nextOffset: number;
  hasMore: boolean;
  group: string;
}

function pagesOf(state: AppState): Record<string, LoadedPage> {
  if (!state.entityPages) state.entityPages = {};
  return state.entityPages as Record<string, LoadedPage>;
}

// Tracks loaded for an album/playlist route, for queue-context use. A
// direct play from such a route should continue inside the same list
// instead of jumping to a stale pool head.
export function poolTracksForRoute(state: AppState, route: unknown): CatalogTrackT[] | null {
  if (!route || typeof route !== 'object') return null;
  const r = route as { kind: string; id?: string };
  if ((r.kind !== 'album' && r.kind !== 'playlist') || !r.id) return null;
  const items = pagesOf(state)[`${r.kind}:${r.id}`]?.items as CatalogTrackT[] | undefined;
  if (!items || items.length === 0) return null;
  const tracks = items.filter((t) => t && typeof t.uri === 'string');
  return tracks.length > 0 ? tracks : null;
}

function fail(ui: Ui | null, label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ui?.setStatus(`${label} failed: ${msg} — playback unaffected`, true);
}

// Fetch every remaining page in the background (8-parallel, like
// spotify-player's `all_paging_items`) and append it to the already
// painted first page. Best-effort: failures stay silent because the
// first page is already visible and `hasMore` keeps manual paging alive.
function prefetchRemaining(
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

// First-page load for entity routes. Cached pages render instantly;
// failures stay page-local and never touch playback.
export async function ensureEntityRoute(deps: EntityLoaderDeps, route: unknown): Promise<void> {
  const { entityManager, getUi, state } = deps;
  const ui = getUi();
  if (!ui || !route || typeof route !== 'object') return;
  const r = route as { kind: string; id?: string };
  if (r.kind === 'artist' && r.id) {
    try {
      const view = await entityManager.loadArtist(r.id);
      if (view.type === 'artist' && view.completeness === 'complete' && view.artist) {
        ui.setArtistHeader(view.artist as { name: string });
      } else {
        ui.setArtistHeader(null);
      }
    } catch {
      ui.setArtistHeader(null);
    }
    const group = artistGroups.get(r.id) ?? 'album';
    const key = `artist:${r.id}:${group}`;
    if (pagesOf(state)[key]) {
      ui.setArtistAlbums(pagesOf(state)[key]?.items as CatalogAlbumT[]);
      return;
    }
    ui.setStatus('Loading artist releases…');
    try {
      const page = await entityManager.loadArtistAlbums(r.id, group, 0, ARTIST_PAGE_SIZE);
      const items = page.items as CatalogAlbumT[];
      pagesOf(state)[key] = {
        items,
        nextOffset: page.offset + items.length,
        hasMore: page.hasMore,
        group,
      };
      ui.setArtistAlbums(items);
      if (page.hasMore)
        prefetchRemaining(deps, 'artist', r.id, group, ARTIST_PAGE_SIZE, page.total);
    } catch (err) {
      fail(ui, 'Artist releases', err);
    }
    return;
  }
  if (r.kind === 'album' && r.id) {
    try {
      const view = await entityManager.loadAlbum(r.id);
      if (view.type === 'album' && view.completeness === 'complete' && view.album) {
        ui.setAlbumHeader(view.album as { name: string; artists: Array<{ name: string }> });
      } else {
        ui.setAlbumHeader(null);
      }
    } catch {
      ui.setAlbumHeader(null);
    }
    const key = `album:${r.id}`;
    if (pagesOf(state)[key]) {
      ui.setAlbumTracks(pagesOf(state)[key]?.items as CatalogTrackT[]);
      return;
    }
    ui.setStatus('Loading album tracks…');
    try {
      const page = await entityManager.loadAlbumTracks(r.id, 0, PAGE_SIZE);
      const items = page.items as CatalogTrackT[];
      pagesOf(state)[key] = {
        items,
        nextOffset: page.offset + items.length,
        hasMore: page.hasMore,
        group: '',
      };
      ui.setAlbumTracks(items);
      if (page.hasMore) prefetchRemaining(deps, 'album', r.id, '', PAGE_SIZE, page.total);
    } catch (err) {
      fail(ui, 'Album tracks', err);
    }
    return;
  }
  if (r.kind === 'playlist' && r.id) {
    let unavailable = false;
    try {
      const view = await entityManager.loadPlaylist(r.id);
      if (view.type === 'playlist' && view.completeness === 'complete' && view.playlist) {
        ui.setPlaylistHeader(view.playlist as { name: string; owner?: { displayName?: string } });
      } else {
        ui.setPlaylistHeader(null);
        unavailable = true;
      }
    } catch {
      ui.setPlaylistHeader(null);
      unavailable = true;
    }
    const key = `playlist:${r.id}`;
    if (pagesOf(state)[key]) {
      ui.setPlaylistTracks(pagesOf(state)[key]?.items as CatalogTrackT[]);
      return;
    }
    ui.setStatus('Loading playlist tracks…');
    try {
      const page = await entityManager.loadPlaylistTracks(r.id, 0, 100);
      const items = page.items as CatalogTrackT[];
      pagesOf(state)[key] = {
        items,
        nextOffset: page.offset + items.length,
        hasMore: page.hasMore,
        group: '',
      };
      ui.setPlaylistTracks(items);
      if (page.hasMore) prefetchRemaining(deps, 'playlist', r.id, '', 100, page.total);
      if (unavailable && items.length === 0) {
        ui.setStatus(
          'Playlist unavailable — it may be private, region-locked, or restricted for this app',
          true,
        );
      }
    } catch (err) {
      fail(ui, 'Playlist tracks', err);
    }
  }
}

// Append the next page when selection reaches the end of a loaded list.
const loadingMore = new Set<string>();
const artistGroups = new Map<string, ArtistReleaseGroupT>();

export async function loadMoreEntityItems(
  deps: EntityLoaderDeps,
  kind: 'artist' | 'album' | 'playlist',
  id: string,
): Promise<void> {
  const { getUi, state } = deps;
  const ui = getUi();
  if (!ui) return;
  const pages = pagesOf(state);
  const key =
    kind === 'artist' ? `artist:${id}:${artistGroups.get(id) ?? 'album'}` : `${kind}:${id}`;
  const prev = pages[key];
  if (!prev || !prev.hasMore || loadingMore.has(key)) return;
  loadingMore.add(key);
  try {
    await appendEntityPage(deps, kind, id, key, prev);
  } finally {
    loadingMore.delete(key);
  }
}

async function appendEntityPage(
  deps: EntityLoaderDeps,
  kind: 'artist' | 'album' | 'playlist',
  id: string,
  key: string,
  prev: LoadedPage,
): Promise<void> {
  const { entityManager, getUi, state } = deps;
  const ui = getUi();
  if (!ui) return;
  const pages = pagesOf(state);
  if (kind === 'artist') {
    const group = artistGroups.get(id) ?? 'album';
    try {
      const page = await entityManager.loadArtistAlbums(
        id,
        group,
        prev.nextOffset,
        ARTIST_PAGE_SIZE,
      );
      const items = page.items as CatalogAlbumT[];
      pages[key] = {
        items: [...prev.items, ...items],
        nextOffset: page.offset + items.length,
        hasMore: page.hasMore,
        group,
      };
      ui.setArtistAlbums(items, { append: true });
    } catch (err) {
      fail(ui, 'More releases', err);
    }
    return;
  }
  try {
    const page =
      kind === 'album'
        ? await entityManager.loadAlbumTracks(id, prev.nextOffset, PAGE_SIZE)
        : await entityManager.loadPlaylistTracks(id, prev.nextOffset, 100);
    const items = page.items as CatalogTrackT[];
    pages[key] = {
      items: [...prev.items, ...items],
      nextOffset: page.offset + items.length,
      hasMore: page.hasMore,
      group: '',
    };
    if (kind === 'album') ui.setAlbumTracks(items, { append: true });
    else ui.setPlaylistTracks(items, { append: true });
  } catch (err) {
    fail(ui, 'More tracks', err);
  }
}

// Switch an artist release group tab; each group pages independently.
export async function switchArtistGroup(
  deps: EntityLoaderDeps,
  id: string,
  group: ArtistReleaseGroupT,
): Promise<void> {
  const { entityManager, getUi, state } = deps;
  const ui = getUi();
  if (!ui) return;
  artistGroups.set(id, group);
  const key = `artist:${id}:${group}`;
  const prev = pagesOf(state)[key];
  if (prev) {
    ui.setArtistAlbums(prev.items as CatalogAlbumT[]);
    return;
  }
  try {
    const page = await entityManager.loadArtistAlbums(id, group, 0, ARTIST_PAGE_SIZE);
    const items = page.items as CatalogAlbumT[];
    pagesOf(state)[key] = {
      items,
      nextOffset: page.offset + items.length,
      hasMore: page.hasMore,
      group,
    };
    ui.setArtistAlbums(items);
    ui.setStatus(`Artist releases: ${group}`);
    if (page.hasMore) prefetchRemaining(deps, 'artist', id, group, ARTIST_PAGE_SIZE, page.total);
  } catch (err) {
    fail(ui, `Releases (${group})`, err);
  }
}
