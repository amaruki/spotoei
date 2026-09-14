// Library endpoints: paged views of saved tracks/albums, followed artists,
// user playlists, plus save/remove mutations.

import type { CatalogPlaylistT, LibraryPageResponseT } from 'spotoei-protocol';
import {
  fetchFollowedArtists,
  fetchSavedAlbums,
  fetchSavedShows,
  fetchSavedTracks,
  fetchUserPlaylists,
} from './libraryPages';
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
        return await fetchSavedTracks(this.transport, safeOffset, safeLimit);
      }
      if (collection === 'saved_albums') {
        return await fetchSavedAlbums(this.transport, safeOffset, safeLimit);
      }
      if (collection === 'followed_artists') {
        return await fetchFollowedArtists(
          this.transport,
          safeOffset,
          safeLimit,
          cursor,
          this.artistCursors,
        );
      }
      if (collection === 'saved_shows') {
        return await fetchSavedShows(this.transport, safeOffset, safeLimit);
      }
      if (collection === 'playlists') {
        return await fetchUserPlaylists(this.transport, safeOffset, safeLimit);
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

  async getUserPlaylistTree(
    safeOffset = 0,
    safeLimit = 50,
    options?: StructurizeOptions,
  ): Promise<Array<PlaylistFolderNode | CatalogPlaylistT>> {
    const page = await fetchUserPlaylists(this.transport, safeOffset, safeLimit);
    return structurizePlaylists(page.items as CatalogPlaylistT[], options);
  }
}
