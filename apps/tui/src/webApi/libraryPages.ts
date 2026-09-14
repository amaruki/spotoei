// Paged library fetchers. Extracted from library.ts so the endpoint class
// body stays under the 300 LoC ceiling; behaviour is unchanged.

import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogPlaylistT,
  CatalogShowT,
  CatalogTrackT,
  LibraryPageResponseT,
} from 'spotoei-protocol';
import { mapAlbum, mapArtist, mapPlaylist, mapShow, mapTrack } from './mappers';
import { pickObjectKey, readNumber, toArray } from './shape';
import type { Transport } from './transport';

export async function fetchSavedTracks(
  transport: Transport,
  safeOffset: number,
  safeLimit: number,
): Promise<LibraryPageResponseT> {
  const collection = 'saved_tracks' as const;
  const json = await transport.request(
    `/me/tracks?offset=${safeOffset}&limit=${safeLimit}&market=from_token`,
  );
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const tracks: CatalogTrackT[] = [];
  for (const item of rawItems) {
    if (item !== null && typeof item === 'object' && 'track' in item) {
      const track = (item as { track: unknown }).track;
      const mapped = mapTrack(track);
      if (mapped) tracks.push(mapped);
    }
  }
  const total = readNumber(json, 'total', tracks.length);
  const nextOffset = safeOffset + rawItems.length;
  return {
    collection,
    items: tracks,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: nextOffset < total && rawItems.length > 0,
    nextOffset,
  };
}

export async function fetchSavedAlbums(
  transport: Transport,
  safeOffset: number,
  safeLimit: number,
): Promise<LibraryPageResponseT> {
  const collection = 'saved_albums' as const;
  const json = await transport.request(
    `/me/albums?offset=${safeOffset}&limit=${safeLimit}&market=from_token`,
  );
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const albums: CatalogAlbumT[] = [];
  for (const item of rawItems) {
    if (item !== null && typeof item === 'object' && 'album' in item) {
      const album = (item as { album: unknown }).album;
      const mapped = mapAlbum(album);
      if (mapped) albums.push(mapped);
    }
  }
  const total = readNumber(json, 'total', 0);
  const nextOffset = safeOffset + rawItems.length;
  return {
    collection,
    items: albums,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: nextOffset < total && rawItems.length > 0,
    nextOffset,
  };
}

export async function fetchFollowedArtists(
  transport: Transport,
  safeOffset: number,
  safeLimit: number,
  cursor: string | undefined,
  artistCursors: Map<number, string>,
): Promise<LibraryPageResponseT> {
  const collection = 'followed_artists' as const;
  let effectiveCursor = cursor;

  if (!effectiveCursor && safeOffset > 0) {
    effectiveCursor = artistCursors.get(safeOffset);
    if (!effectiveCursor) {
      // Walk cursors from 0 up to safeOffset
      let currentOffset = 0;
      let walkCursor: string | undefined;
      while (currentOffset < safeOffset) {
        const walkUrl = walkCursor
          ? `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(walkCursor)}`
          : `/me/following?type=artist&limit=${safeLimit}`;
        // oxlint-disable-next-line no-await-in-loop -- cursor pagination walks sequentially
        const walkJson = await transport.request(walkUrl);
        const walkArtistsObj =
          walkJson !== null && typeof walkJson === 'object' && 'artists' in walkJson
            ? (walkJson as { artists: unknown }).artists
            : null;
        const walkItems = toArray(
          walkArtistsObj !== null && typeof walkArtistsObj === 'object' && 'items' in walkArtistsObj
            ? (walkArtistsObj as { items: unknown }).items
            : undefined,
        );
        if (walkItems.length === 0) break;
        const walkCursorObj =
          walkArtistsObj !== null &&
          typeof walkArtistsObj === 'object' &&
          'cursors' in walkArtistsObj
            ? ((walkArtistsObj as { cursors: unknown }).cursors as { after?: unknown } | null)
            : null;
        walkCursor =
          walkCursorObj && typeof walkCursorObj.after === 'string'
            ? walkCursorObj.after
            : undefined;
        currentOffset += walkItems.length;
        if (walkCursor) {
          artistCursors.set(currentOffset, walkCursor);
        }
        if (!walkCursor) break;
      }
      effectiveCursor = artistCursors.get(safeOffset);
    }
  }

  const url = effectiveCursor
    ? `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(effectiveCursor)}`
    : `/me/following?type=artist&limit=${safeLimit}`;
  const json = await transport.request(url);
  const artistsObj =
    json !== null && typeof json === 'object' && 'artists' in json
      ? (json as { artists: unknown }).artists
      : null;
  const rawItems = toArray(
    artistsObj !== null && typeof artistsObj === 'object' && 'items' in artistsObj
      ? (artistsObj as { items: unknown }).items
      : undefined,
  );
  const total =
    artistsObj !== null && typeof artistsObj === 'object' && 'total' in artistsObj
      ? typeof (artistsObj as { total: unknown }).total === 'number'
        ? (artistsObj as { total: number }).total
        : rawItems.length
      : rawItems.length;
  const cursorObj =
    artistsObj !== null && typeof artistsObj === 'object' && 'cursors' in artistsObj
      ? ((artistsObj as { cursors: unknown }).cursors as { after?: unknown } | null)
      : null;
  const nextCursor = cursorObj && typeof cursorObj.after === 'string' ? cursorObj.after : undefined;

  const nextOffset = safeOffset + rawItems.length;
  if (nextCursor) {
    artistCursors.set(nextOffset, nextCursor);
  }

  const artists: CatalogArtistT[] = [];
  for (const item of rawItems) {
    const mapped = mapArtist(item);
    if (mapped) artists.push(mapped);
  }

  return {
    collection,
    items: artists,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: Boolean(nextCursor) && rawItems.length > 0 && nextOffset < total,
    nextOffset,
    nextCursor,
  };
}

export async function fetchSavedShows(
  transport: Transport,
  safeOffset: number,
  safeLimit: number,
): Promise<LibraryPageResponseT> {
  const collection = 'saved_shows' as const;
  const json = await transport.request(
    `/me/shows?offset=${safeOffset}&limit=${safeLimit}&market=from_token`,
  );
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const shows: CatalogShowT[] = [];
  for (const item of rawItems) {
    const m = mapShow((item as { show?: unknown })?.show ?? item);
    if (m) shows.push(m);
  }
  const total = readNumber(json, 'total', shows.length);
  const nextOffset = safeOffset + rawItems.length;
  return {
    collection,
    items: shows,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: nextOffset < total && rawItems.length > 0,
    nextOffset,
  };
}

export async function fetchUserPlaylists(
  transport: Transport,
  safeOffset: number,
  safeLimit: number,
): Promise<LibraryPageResponseT> {
  const collection = 'playlists' as const;
  const json = await transport.request(`/me/playlists?offset=${safeOffset}&limit=${safeLimit}`);
  const rawItems = toArray(pickObjectKey(json, 'items'));
  const playlists: CatalogPlaylistT[] = [];
  for (const item of rawItems) {
    const m = mapPlaylist(item);
    if (m) playlists.push(m);
  }
  const total = readNumber(json, 'total', playlists.length);
  const nextOffset = safeOffset + rawItems.length;
  return {
    collection,
    items: playlists,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: nextOffset < total && rawItems.length > 0,
    nextOffset,
  };
}
