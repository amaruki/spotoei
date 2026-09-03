// Library endpoints: paged views of saved tracks/albums, followed artists,
// user playlists, plus save/remove mutations.

import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogPlaylistT,
  CatalogTrackT,
  LibraryPageResponseT,
} from 'spotoei-protocol';
import { followNextCursor } from './cursor';
import { mapAlbum, mapArtist, mapPlaylist, mapTrack } from './mappers';
import { pickObjectKey, readNumber, toArray } from './shape';
import type { Transport } from './transport';

export class LibraryEndpoints {
  constructor(private transport: Transport) {}

  async getLibraryPage(
    collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
    offset = 0,
    limit = 20,
  ): Promise<LibraryPageResponseT> {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const safeOffset = Math.max(0, offset);

    try {
      if (collection === 'saved_tracks') {
        return await this.fetchSavedTracks(safeOffset, safeLimit);
      }
      if (collection === 'saved_albums') {
        return await this.fetchSavedAlbums(safeOffset, safeLimit);
      }
      if (collection === 'followed_artists') {
        return await this.fetchFollowedArtists(safeOffset, safeLimit);
      }
      if (collection === 'playlists') {
        return await this.fetchUserPlaylists(safeOffset, safeLimit);
      }
      return {
        collection,
        items: [],
        total: 0,
        offset: safeOffset,
        limit: safeLimit,
        hasMore: false,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.startsWith('RATE_LIMITED')
        ? 'RATE_LIMITED'
        : msg.startsWith('AUTH_EXPIRED')
          ? 'AUTH_EXPIRED'
          : msg.startsWith('FORBIDDEN')
            ? 'FORBIDDEN'
            : 'NETWORK_ERROR';
      return {
        collection,
        items: [],
        total: 0,
        offset: safeOffset,
        limit: safeLimit,
        hasMore: false,
        error: {
          code,
          message: msg,
          retryable: code !== 'AUTH_EXPIRED' && code !== 'FORBIDDEN',
        },
      };
    }
  }

  async checkMembership(uris: string[]): Promise<boolean[]> {
    if (uris.length === 0) return [];
    const safeBatch = uris.slice(0, 50);
    const list = safeBatch.map(encodeURIComponent).join(',');
    try {
      const json = await this.transport.request(`/me/library/contains?uris=${list}`);
      return Array.isArray(json) ? (json as boolean[]) : safeBatch.map(() => false);
    } catch {
      return safeBatch.map(() => false);
    }
  }

  async saveUris(uris: string[]): Promise<boolean> {
    if (uris.length === 0) return true;
    const list = uris.map(encodeURIComponent).join(',');
    try {
      await this.transport.request(`/me/library?uris=${list}`, {}, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  async removeUris(uris: string[]): Promise<boolean> {
    if (uris.length === 0) return true;
    const list = uris.map(encodeURIComponent).join(',');
    try {
      await this.transport.request(`/me/library?uris=${list}`, {}, 'DELETE');
      return true;
    } catch {
      return false;
    }
  }

  // Deprecated: kept for compatibility until callers migrate to URI mutations.
  async saveItem(type: 'track' | 'album', id: string): Promise<boolean> {
    const uri = type === 'track' ? `spotify:track:${id}` : `spotify:album:${id}`;
    return this.saveUris([uri]);
  }

  // Deprecated: kept for compatibility until callers migrate to URI mutations.
  async removeItem(type: 'track' | 'album', id: string): Promise<boolean> {
    const uri = type === 'track' ? `spotify:track:${id}` : `spotify:album:${id}`;
    return this.removeUris([uri]);
  }

  private async fetchSavedTracks(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'saved_tracks' as const;
    const json = await this.transport.request(`/me/tracks?offset=${safeOffset}&limit=${safeLimit}`);
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
    return {
      collection,
      items: tracks,
      total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + tracks.length < total,
    };
  }

  private async fetchSavedAlbums(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'saved_albums' as const;
    const json = await this.transport.request(`/me/albums?offset=${safeOffset}&limit=${safeLimit}`);
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
    return {
      collection,
      items: albums,
      total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + albums.length < total,
    };
  }

  private async fetchFollowedArtists(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'followed_artists' as const;
    const json = await this.transport.request(`/me/following?type=artist&limit=${safeLimit}`);
    const artistsObj =
      json !== null && typeof json === 'object' && 'artists' in json
        ? (json as { artists: unknown }).artists
        : null;
    const baseItems = toArray(
      artistsObj !== null && typeof artistsObj === 'object' && 'items' in artistsObj
        ? (artistsObj as { items: unknown }).items
        : undefined,
    );
    const baseTotal =
      artistsObj !== null && typeof artistsObj === 'object' && 'total' in artistsObj
        ? typeof (artistsObj as { total: unknown }).total === 'number'
          ? (artistsObj as { total: number }).total
          : baseItems.length
        : baseItems.length;
    const baseCursor =
      artistsObj !== null && typeof artistsObj === 'object' && 'cursors' in artistsObj
        ? ((artistsObj as { cursors: unknown }).cursors as {
            after?: unknown;
          } | null)
        : null;
    const baseAfter =
      baseCursor && typeof baseCursor.after === 'string' ? baseCursor.after : undefined;

    type FollowedPage = {
      items: unknown[];
      total: number;
      after: string | undefined;
    };
    const firstPage: FollowedPage = {
      items: baseItems,
      total: baseTotal,
      after: baseAfter,
    };
    const nextUrlFrom = (page: FollowedPage): string | undefined => {
      if (!page.after) return undefined;
      return `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(page.after)}`;
    };
    const fetchNext = async (url: string): Promise<FollowedPage | null> => {
      try {
        const next = await this.transport.request(url);
        const obj =
          next !== null && typeof next === 'object' && 'artists' in next
            ? (next as { artists: unknown }).artists
            : null;
        const items = toArray(
          obj !== null && typeof obj === 'object' && 'items' in obj
            ? (obj as { items: unknown }).items
            : undefined,
        );
        const total =
          obj !== null && typeof obj === 'object' && 'total' in obj
            ? typeof (obj as { total: unknown }).total === 'number'
              ? (obj as { total: number }).total
              : items.length
            : items.length;
        const cursor =
          obj !== null && typeof obj === 'object' && 'cursors' in obj
            ? ((obj as { cursors: unknown }).cursors as { after?: unknown } | null)
            : null;
        const after = cursor && typeof cursor.after === 'string' ? cursor.after : undefined;
        return { items, total, after };
      } catch {
        return null;
      }
    };
    const combined = await followNextCursor<FollowedPage>(
      firstPage,
      fetchNext,
      (page) => nextUrlFrom(page),
      (a, b) => ({ items: a.items.concat(b.items), total: a.total, after: b.after }),
      5,
    );

    const artists: CatalogArtistT[] = [];
    for (const item of combined.items) {
      const mapped = mapArtist(item);
      if (mapped) artists.push(mapped);
    }
    return {
      collection,
      items: artists,
      total: combined.total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + artists.length < combined.total,
    };
  }

  private async fetchUserPlaylists(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'playlists' as const;
    const json = await this.transport.request(
      `/me/playlists?offset=${safeOffset}&limit=${safeLimit}`,
    );
    const rawItems = toArray(pickObjectKey(json, 'items'));
    const playlists: CatalogPlaylistT[] = [];
    for (const item of rawItems) {
      const mapped = mapPlaylist(item);
      if (mapped) playlists.push(mapped);
    }
    const total = readNumber(json, 'total', playlists.length);
    return {
      collection,
      items: playlists,
      total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + playlists.length < total,
    };
  }
}
