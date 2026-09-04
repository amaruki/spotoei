import type { ArtistReleaseGroupT, CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import type { Ui } from '../ui/types';
import type { AppState } from './types';

const PAGE_SIZE = 20;

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

function fail(ui: Ui | null, label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ui?.setStatus(`${label} failed: ${msg} — playback unaffected`, true);
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
      const page = await entityManager.loadArtistAlbums(r.id, group, 0, PAGE_SIZE);
      const items = page.items as CatalogAlbumT[];
      pagesOf(state)[key] = {
        items,
        nextOffset: page.offset + items.length,
        hasMore: page.hasMore,
        group,
      };
      ui.setArtistAlbums(items);
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
    } catch (err) {
      fail(ui, 'Album tracks', err);
    }
    return;
  }
  if (r.kind === 'playlist' && r.id) {
    try {
      const view = await entityManager.loadPlaylist(r.id);
      if (view.type === 'playlist' && view.completeness === 'complete' && view.playlist) {
        ui.setPlaylistHeader(view.playlist as { name: string; owner?: { displayName?: string } });
      } else {
        ui.setPlaylistHeader(null);
      }
    } catch {
      ui.setPlaylistHeader(null);
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
      const page = await entityManager.loadArtistAlbums(id, group, prev.nextOffset, PAGE_SIZE);
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
    const page = await entityManager.loadArtistAlbums(id, group, 0, PAGE_SIZE);
    const items = page.items as CatalogAlbumT[];
    pagesOf(state)[key] = {
      items,
      nextOffset: page.offset + items.length,
      hasMore: page.hasMore,
      group,
    };
    ui.setArtistAlbums(items);
    ui.setStatus(`Artist releases: ${group}`);
  } catch (err) {
    fail(ui, `Releases (${group})`, err);
  }
}
