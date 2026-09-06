// @ts-nocheck
// Fetch helpers for LibraryEndpoints — extracted to keep library.ts <300 LOC.
import type { CatalogAlbumT, CatalogArtistT, CatalogPlaylistT, CatalogShowT, CatalogTrackT, LibraryPageResponseT } from 'spotoei-protocol';
import { followNextCursor } from '../cursor';
import { mapAlbum, mapArtist, mapPlaylist, mapShow, mapTrack } from '../mappers';
import { pickObjectKey, readNumber, toArray } from '../shape';
import type { Transport } from '../transport';

export async function fetchSavedTracks(transport: Transport, safeOffset: number, safeLimit: number): Promise<LibraryPageResponseT> {
  const collection = 'saved_tracks' as const;
  const json = await transport.request(`/me/tracks?offset=${safeOffset}&limit=${safeLimit}`);
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const tracks: CatalogTrackT[] = [];
  for (const item of rawItems) {
    if (item !== null && typeof item === 'object' && 'track' in item) {
      const mapped = mapTrack((item as { track: unknown }).track);
      if (mapped) tracks.push(mapped);
    }
  }
  const total = readNumber(json, 'total', rawItems.length);
  return { collection, items: tracks, total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + rawItems.length < total };
}

export async function fetchSavedAlbums(transport: Transport, safeOffset: number, safeLimit: number): Promise<LibraryPageResponseT> {
  const collection = 'saved_albums' as const;
  const json = await transport.request(`/me/albums?offset=${safeOffset}&limit=${safeLimit}`);
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const albums: CatalogAlbumT[] = [];
  for (const item of rawItems) {
    if (item !== null && typeof item === 'object' && 'album' in item) {
      const mapped = mapAlbum((item as { album: unknown }).album);
      if (mapped) albums.push(mapped);
    }
  }
  const total = readNumber(json, 'total', rawItems.length);
  return { collection, items: albums, total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + rawItems.length < total };
}

export async function fetchFollowedArtists(transport: Transport, safeOffset: number, safeLimit: number): Promise<LibraryPageResponseT> {
  const collection = 'followed_artists' as const;
  const json = await transport.request(`/me/following?type=artist&limit=${safeLimit}`);
  const artistsObj = json !== null && typeof json === 'object' && 'artists' in json ? (json as { artists: unknown }).artists : null;
  const baseItems = toArray(artistsObj !== null && typeof artistsObj === 'object' && 'items' in artistsObj ? (artistsObj as { items: unknown }).items : undefined);
  const baseTotal = artistsObj !== null && typeof artistsObj === 'object' && 'total' in artistsObj ? typeof (artistsObj as { total: unknown }).total === 'number' ? (artistsObj as { total: number }).total : baseItems.length : baseItems.length;
  const baseCursor = artistsObj !== null && typeof artistsObj === 'object' && 'cursors' in artistsObj ? ((artistsObj as { cursors: unknown }).cursors as { after?: unknown } | null) : null;
  const baseAfter = baseCursor && typeof baseCursor.after === 'string' ? baseCursor.after : undefined;
  type FollowedPage = { items: unknown[]; total: number; after: string | undefined };
  const firstPage: FollowedPage = { items: baseItems, total: baseTotal, after: baseAfter };
  const nextUrlFrom = (p: FollowedPage) => p.after ? `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(p.after)}` : undefined;
  const fetchNext = async (url: string): Promise<FollowedPage | null> => {
    try {
      const next = await transport.request(url);
      const obj = next !== null && typeof next === 'object' && 'artists' in next ? (next as { artists: unknown }).artists : null;
      const items = toArray(obj !== null && typeof obj === 'object' && 'items' in obj ? (obj as { items: unknown }).items : undefined);
      const total = obj !== null && typeof obj === 'object' && 'total' in obj ? typeof (obj as { total: unknown }).total === 'number' ? (obj as { total: number }).total : items.length : items.length;
      const cursor = obj !== null && typeof obj === 'object' && 'cursors' in obj ? ((obj as { cursors: unknown }).cursors as { after?: unknown } | null) : null;
      const after = cursor && typeof cursor.after === 'string' ? cursor.after : undefined;
      return { items, total, after };
    } catch { return null; }
  };
  const combined = await followNextCursor<FollowedPage>(firstPage, fetchNext, (p) => nextUrlFrom(p), (a, b) => ({ items: a.items.concat(b.items), total: a.total, after: b.after }), 5);
  const artists: CatalogArtistT[] = [];
  for (const item of combined.items) { const m = mapArtist(item); if (m) artists.push(m); }
  return { collection, items: artists, total: combined.total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + artists.length < combined.total };
}

export async function fetchSavedShows(transport: Transport, safeOffset: number, safeLimit: number): Promise<LibraryPageResponseT> {
  const collection = 'saved_shows' as const;
  const json = await transport.request(`/me/shows?limit=${safeLimit}&offset=${safeOffset}&market=from_token`);
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const shows: CatalogShowT[] = [];
  for (const item of rawItems) {
    const raw = item !== null && typeof item === 'object' && 'show' in (item as Record<string, unknown>) ? (item as { show: unknown }).show : item;
    const m = mapShow(raw);
    if (m) shows.push(m);
  }
  const total = readNumber(json, 'total', rawItems.length);
  return { collection, items: shows, total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + rawItems.length < total };
}

export async function fetchUserPlaylists(transport: Transport, safeOffset: number, safeLimit: number): Promise<LibraryPageResponseT> {
  const collection = 'playlists' as const;
  const json = await transport.request(`/me/playlists?offset=${safeOffset}&limit=${safeLimit}`);
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const playlists: CatalogPlaylistT[] = [];
  for (const item of rawItems) { const m = mapPlaylist(item); if (m) playlists.push(m); }
  const total = readNumber(json, 'total', rawItems.length);
  return { collection, items: playlists, total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + rawItems.length < total };
}
