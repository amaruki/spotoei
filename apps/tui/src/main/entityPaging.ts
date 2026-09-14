// @ts-nocheck
import type { ArtistReleaseGroupT, CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import {
  ARTIST_PAGE_SIZE,
  artistGroups,
  type EntityLoaderDeps,
  fail,
  type LoadedPage,
  loadingMore,
  PAGE_SIZE,
  pagesOf,
} from './entityPages';
import { prefetchRemaining } from './entityPrefetch';

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
