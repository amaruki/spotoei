// Library endpoints: paged views of saved tracks/albums, followed artists,
// user playlists, plus save/remove mutations.

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
import {
  type PlaylistFolderNode,
  type PlaylistT,
  type StructurizeOptions,
  structurizePlaylists,
  toggleFolderExpanded,
  flattenPlaylistTree,
  isPlaylistFolderNode,
} from '../library/collections';

export {
  type PlaylistFolderNode,
  type PlaylistT,
  type StructurizeOptions,
  structurizePlaylists,
  toggleFolderExpanded,
  flattenPlaylistTree,
  isPlaylistFolderNode,
};
export class LibraryEndpoints {
  private artistCursors = new Map<number, string>();

  constructor(private transport: Transport) {}

  resetCursors(): void {
    this.artistCursors.clear();
  }

  async getLibraryPage(
    collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists' | 'saved_shows',
    offset = 0,
    limit = 20,
    cursor?: string,
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
        return await this.fetchFollowedArtists(safeOffset, safeLimit, cursor);
      }
      if (collection === 'saved_shows') {
        return await this.fetchSavedShows(safeOffset, safeLimit);
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
      const code = msg.startsWith('QUOTA_EXCEEDED')
        ? 'QUOTA_EXCEEDED'
        : msg.startsWith('RATE_LIMITED')
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
          retryable: code !== 'AUTH_EXPIRED' && code !== 'FORBIDDEN' && code !== 'QUOTA_EXCEEDED',
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
    const json = await this.transport.request(
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

  private async fetchSavedAlbums(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'saved_albums' as const;
    const json = await this.transport.request(
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

  private async fetchFollowedArtists(
    safeOffset: number,
    safeLimit: number,
    cursor?: string,
  ): Promise<LibraryPageResponseT> {
    const collection = 'followed_artists' as const;
    let effectiveCursor = cursor;

    if (!effectiveCursor && safeOffset > 0) {
      effectiveCursor = this.artistCursors.get(safeOffset);
      if (!effectiveCursor) {
        // Walk cursors from 0 up to safeOffset
        let currentOffset = 0;
        let walkCursor: string | undefined;
        while (currentOffset < safeOffset) {
          const walkUrl = walkCursor
            ? `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(walkCursor)}`
            : `/me/following?type=artist&limit=${safeLimit}`;
          const walkJson = await this.transport.request(walkUrl);
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
            walkArtistsObj !== null && typeof walkArtistsObj === 'object' && 'cursors' in walkArtistsObj
              ? ((walkArtistsObj as { cursors: unknown }).cursors as { after?: unknown } | null)
              : null;
          walkCursor =
            walkCursorObj && typeof walkCursorObj.after === 'string'
              ? walkCursorObj.after
              : undefined;
          currentOffset += walkItems.length;
          if (walkCursor) {
            this.artistCursors.set(currentOffset, walkCursor);
          }
          if (!walkCursor) break;
        }
        effectiveCursor = this.artistCursors.get(safeOffset);
      }
    }

    const url = effectiveCursor
      ? `/me/following?type=artist&limit=${safeLimit}&after=${encodeURIComponent(effectiveCursor)}`
      : `/me/following?type=artist&limit=${safeLimit}`;
    const json = await this.transport.request(url);
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
    const nextCursor =
      cursorObj && typeof cursorObj.after === 'string' ? cursorObj.after : undefined;

    const nextOffset = safeOffset + rawItems.length;
    if (nextCursor) {
      this.artistCursors.set(nextOffset, nextCursor);
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

  private async fetchSavedShows(
    safeOffset: number,
    safeLimit: number,
  ): Promise<LibraryPageResponseT> {
    const collection = 'saved_shows' as const;
    const json = await this.transport.request(
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

  async getUserPlaylistTree(
    safeOffset = 0,
    safeLimit = 50,
    options?: StructurizeOptions,
  ): Promise<Array<PlaylistFolderNode | CatalogPlaylistT>> {
    const page = await this.fetchUserPlaylists(safeOffset, safeLimit);
    return structurizePlaylists(page.items as CatalogPlaylistT[], options);
  }
}
