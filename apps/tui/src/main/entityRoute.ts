// @ts-nocheck
import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import {
  ARTIST_PAGE_SIZE,
  artistGroups,
  type EntityLoaderDeps,
  fail,
  PAGE_SIZE,
  pagesOf,
} from './entityPages';
import { prefetchRemaining } from './entityPrefetch';

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
