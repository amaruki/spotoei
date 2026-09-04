// Library manager for paginated local library views, caching through SQLite,
// and optimistic save/remove mutations.

import { Cache } from './cache';
import { WebApiClient } from './webApi';
import type { LibraryCollectionT, LibraryPageResponseT } from 'spotoei-protocol';

export interface LibraryManagerOptions {
  webApi: WebApiClient;
  cache: Cache;
  accountId: string;
  cacheTtlMs?: number;
}

export class LibraryManager {
  private webApi: WebApiClient;
  private cache: Cache;
  private accountId: string;
  private cacheTtlMs: number;

  constructor(opts: LibraryManagerOptions) {
    this.webApi = opts.webApi;
    this.cache = opts.cache;
    this.accountId = opts.accountId;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60 * 1000;
  }

  private makeKey(collection: LibraryCollectionT, offset: number, limit: number): string {
    return `library:v1:${collection}:${offset}:${limit}`;
  }

  private makePrefix(collection: LibraryCollectionT): string {
    return `library:v1:${collection}:`;
  }

  async getPage(
    collection: LibraryCollectionT,
    offset = 0,
    limit = 20,
    forceRefresh = false,
  ): Promise<LibraryPageResponseT> {
    const key = this.makeKey(collection, offset, limit);

    if (!forceRefresh) {
      const cached = this.cache.getQuery<LibraryPageResponseT>(this.accountId, key);
      if (cached) {
        const expired = cached.expiresAt !== null && cached.expiresAt < Date.now();
        if (!expired) {
          return cached.payload;
        }
      }
    }

    const fresh = await this.webApi.getLibraryPage(collection, offset, limit);
    if (!fresh.error) {
      this.cache.putQuery(this.accountId, key, fresh, this.cacheTtlMs);
    }
    return fresh;
  }

  async save(type: 'track' | 'album', id: string): Promise<boolean> {
    const uri = type === 'track' ? `spotify:track:${id}` : `spotify:album:${id}`;
    const ok = await this.webApi.saveUris([uri]);
    if (ok) {
      const collection: LibraryCollectionT = type === 'track' ? 'saved_tracks' : 'saved_albums';
      this.cache.invalidateQueryPrefix(this.accountId, this.makePrefix(collection));
      this.cache.invalidateQuery(this.accountId, `membership:v1:${uri}`);
    }
    return ok;
  }

  async remove(type: 'track' | 'album', id: string): Promise<boolean> {
    const uri = type === 'track' ? `spotify:track:${id}` : `spotify:album:${id}`;
    const ok = await this.webApi.removeUris([uri]);
    if (ok) {
      const collection: LibraryCollectionT = type === 'track' ? 'saved_tracks' : 'saved_albums';
      this.cache.invalidateQueryPrefix(this.accountId, this.makePrefix(collection));
      this.cache.invalidateQuery(this.accountId, `membership:v1:${uri}`);
    }
    return ok;
  }

  async savePlaylist(id: string): Promise<boolean> {
    const uri = `spotify:playlist:${id}`;
    const ok = await this.webApi.saveUris([uri]);
    if (ok) {
      this.cache.invalidateQueryPrefix(this.accountId, this.makePrefix('playlists'));
      this.cache.invalidateQuery(this.accountId, `membership:v1:${uri}`);
    }
    return ok;
  }

  async removePlaylist(id: string): Promise<boolean> {
    const uri = `spotify:playlist:${id}`;
    const ok = await this.webApi.removeUris([uri]);
    if (ok) {
      this.cache.invalidateQueryPrefix(this.accountId, this.makePrefix('playlists'));
      this.cache.invalidateQuery(this.accountId, `membership:v1:${uri}`);
    }
    return ok;
  }
  invalidate(collection: LibraryCollectionT): void {
    this.cache.invalidateQueryPrefix(this.accountId, this.makePrefix(collection));
  }

  async refresh(collection?: LibraryCollectionT): Promise<LibraryPageResponseT> {
    if (collection) {
      this.invalidate(collection);
      return this.getPage(collection, 0, 20, true);
    }
    for (const c of ['saved_tracks', 'saved_albums', 'playlists', 'followed_artists'] as const) {
      this.invalidate(c);
    }
    return this.getPage('saved_tracks', 0, 20, true);
  }
}
