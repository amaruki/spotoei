// Entity manager: loads and caches artist/album/playlist pages, resolves membership, and handles playback context.

import type {
  ArtistReleaseGroupT,
  CatalogAlbumT,
  CatalogTrackT,
  EntityViewResponseT,
  LibraryMembershipT,
} from 'spotoei-protocol';
import type { Cache } from './cache';
import type { EntityPageResult } from './webApi/entityEndpoints';
import type { WebApiClient } from './webApi';
import {
  checkMembershipBatched,
  inferKind,
  membershipFor,
  mutateUrisWithPreservation,
} from './entityMutations';

export { inferKind, membershipFor };

export class EntityManager {
  constructor(
    private client: WebApiClient,
    private cache?: Cache,
    private accountId: string = 'default',
  ) {}

  // --- Artist ---

  async loadArtist(id: string, forceRefresh = false): Promise<EntityViewResponseT> {
    const key = `entity:v2:artist:${id}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityViewResponseT>(key, 24 * 60 * 60);
      if (cached) return cached;
    }
    const view = await this.client.getArtistView(id);
    this.putCached(key, view, 24 * 60 * 60_000);
    return view;
  }

  async loadArtistAlbums(
    id: string,
    group: ArtistReleaseGroupT = 'album',
    offset = 0,
    limit = 20,
    forceRefresh = false,
  ): Promise<EntityPageResult<CatalogAlbumT>> {
    const key = `artist:v2:${id}:${group}:${offset}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityPageResult<CatalogAlbumT>>(key, 60 * 60);
      if (cached) return cached;
    }
    const page = await this.client.getArtistAlbums(id, group, offset, limit);
    this.putCached(key, page, 60 * 60_000);
    return page;
  }

  // --- Album ---

  async loadAlbum(id: string, forceRefresh = false): Promise<EntityViewResponseT> {
    const key = `entity:v2:album:${id}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityViewResponseT>(key, 24 * 60 * 60);
      if (cached) return cached;
    }
    const view = await this.client.getAlbumView(id);
    this.putCached(key, view, 24 * 60 * 60_000);
    return view;
  }

  async loadAlbumTracks(
    id: string,
    offset = 0,
    limit = 50,
    forceRefresh = false,
  ): Promise<EntityPageResult<CatalogTrackT>> {
    const key = `album:v2:${id}:tracks:${offset}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityPageResult<CatalogTrackT>>(key, 24 * 60 * 60);
      if (cached) return cached;
    }
    const page = await this.client.getAlbumTracks(id, offset, limit);
    this.putCached(key, page, 24 * 60 * 60_000);
    return page;
  }

  // --- Playlist ---

  async loadPlaylist(id: string, forceRefresh = false): Promise<EntityViewResponseT> {
    const key = `entity:v2:playlist:${id}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityViewResponseT>(key, 5 * 60);
      if (cached) return cached;
    }
    const view = await this.client.getPlaylistView(id);
    this.putCached(key, view, 5 * 60_000);
    return view;
  }

  async loadPlaylistTracks(
    id: string,
    offset = 0,
    limit = 100,
    forceRefresh = false,
  ): Promise<EntityPageResult<CatalogTrackT>> {
    const key = `playlist:v2:${id}:items:${offset}`;
    if (!forceRefresh) {
      const cached = this.tryGetCached<EntityPageResult<CatalogTrackT>>(key, 5 * 60);
      if (cached) return cached;
    }
    const page = await this.client.getPlaylistTracks(id, offset, limit);
    this.putCached(key, page, 5 * 60_000);
    return page;
  }

  // --- Membership & Mutations ---

  async checkMembership(uris: string[], forceRefresh = false): Promise<LibraryMembershipT[]> {
    return checkMembershipBatched(this.client, this.cache, this.accountId, uris, forceRefresh);
  }

  async saveUris(uris: string[]): Promise<{ ok: boolean; error?: string }> {
    return mutateUrisWithPreservation(this.client, this.cache, this.accountId, uris, 'save');
  }

  async removeUris(uris: string[]): Promise<{ ok: boolean; error?: string }> {
    return mutateUrisWithPreservation(this.client, this.cache, this.accountId, uris, 'remove');
  }

  // --- Playback contexts ---

  async playAlbumContext(albumUri: string): Promise<void> {
    await this.client.play({ context_uri: albumUri });
  }

  async playArtistContext(artistUri: string): Promise<void> {
    await this.client.play({ context_uri: artistUri });
  }

  async playPlaylistContext(playlistUri: string): Promise<void> {
    await this.client.play({ context_uri: playlistUri });
  }

  async playTracks(tracks: CatalogTrackT[]): Promise<void> {
    const uris = tracks.map((t) => t.uri);
    await this.client.play({ uris });
  }

  // --- Invalidation ---

  invalidateArtist(id: string): void {
    if (!this.cache) return;
    try {
      this.cache.invalidateQuery(this.accountId, `entity:v2:artist:${id}`);
      this.cache.invalidateQueryPrefix(this.accountId, `artist:v2:${id}:`);
    } catch {
      // Non-fatal
    }
  }

  invalidateAlbum(id: string): void {
    if (!this.cache) return;
    try {
      this.cache.invalidateQuery(this.accountId, `entity:v2:album:${id}`);
      this.cache.invalidateQueryPrefix(this.accountId, `album:v2:${id}:`);
    } catch {
      // Non-fatal
    }
  }

  invalidatePlaylist(id: string): void {
    if (!this.cache) return;
    try {
      this.cache.invalidateQuery(this.accountId, `entity:v2:playlist:${id}`);
      this.cache.invalidateQueryPrefix(this.accountId, `playlist:v2:${id}:`);
    } catch {
      // Non-fatal
    }
  }

  // --- Internals ---

  private tryGetCached<T>(key: string, ttlSeconds: number): T | null {
    if (!this.cache) return null;
    try {
      const cached = this.cache.getQuery<T>(this.accountId, key);
      if (!cached) return null;
      if (cached.expiresAt === null) return null;
      if (Date.now() >= cached.expiresAt) return null;
      if (cached.fetchedAt + ttlSeconds * 1000 < Date.now()) return null;
      return cached.payload;
    } catch {
      return null;
    }
  }

  private putCached(key: string, payload: unknown, ttlMs: number): void {
    if (!this.cache) return;
    try {
      this.cache.putQuery(this.accountId, key, payload, ttlMs);
    } catch {
      // Non-fatal
    }
  }
}
