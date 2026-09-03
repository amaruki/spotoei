// Artist / Album / Playlist entity endpoints, plus Home personalization data.
// Kept separate from `catalog.ts` so each file stays under the 300 LoC rule.

import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogTrackT,
  EntityViewResponseT,
} from 'spotoei-protocol';
import { mapAlbum, mapArtist, mapPlaylist, mapTrack } from './mappers';
import { pickObjectKey, toArray } from './shape';
import type { Transport } from './transport';

export interface EntityPageResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export class EntityEndpoints {
  constructor(private transport: Transport) {}

  async getArtistView(id: string): Promise<EntityViewResponseT> {
    try {
      const json = await this.transport.request(`/artists/${id}`);
      const artist = mapArtist(json);
      if (!artist) throw new Error('invalid artist payload');
      return { type: 'artist', artist, completeness: 'complete' };
    } catch (err: unknown) {
      return {
        type: 'artist',
        artist: {
          id,
          uri: `spotify:artist:${id}`,
          name: 'Unavailable artist',
        },
        completeness: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getArtistAlbums(
    id: string,
    includeGroups?: string,
    offset = 0,
    limit = 20,
  ): Promise<EntityPageResult<CatalogAlbumT>> {
    const params = new URLSearchParams();
    if (includeGroups) params.set('include_groups', includeGroups);
    params.set('offset', String(offset));
    params.set('limit', String(limit));
    try {
      const json = await this.transport.request(`/artists/${id}/albums?${params.toString()}`);
      const items = toArray(pickObjectKey(json, 'items'));
      const albums: CatalogAlbumT[] = [];
      for (const item of items) {
        const mapped = mapAlbum(item);
        if (mapped) albums.push(mapped);
      }
      const total =
        typeof (json as { total?: unknown })?.total === 'number'
          ? (json as { total: number }).total
          : albums.length;
      return {
        items: albums,
        total,
        offset,
        limit,
        hasMore: offset + albums.length < total,
      };
    } catch {
      return { items: [], total: 0, offset, limit, hasMore: false };
    }
  }

  async getAlbumTracks(
    id: string,
    offset = 0,
    limit = 50,
  ): Promise<EntityPageResult<CatalogTrackT>> {
    try {
      const json = await this.transport.request(
        `/albums/${id}/tracks?offset=${offset}&limit=${limit}`,
      );
      const items = toArray(pickObjectKey(json, 'items'));
      const tracks: CatalogTrackT[] = [];
      for (const item of items) {
        const mapped = mapTrack(item);
        if (mapped) tracks.push(mapped);
      }
      const total =
        typeof (json as { total?: unknown })?.total === 'number'
          ? (json as { total: number }).total
          : tracks.length;
      return {
        items: tracks,
        total,
        offset,
        limit,
        hasMore: offset + tracks.length < total,
      };
    } catch {
      return { items: [], total: 0, offset, limit, hasMore: false };
    }
  }

  async getPlaylistView(id: string): Promise<EntityViewResponseT> {
    try {
      const json = await this.transport.request(`/playlists/${id}`);
      const playlist = mapPlaylist(json);
      if (!playlist) throw new Error('invalid playlist payload');
      return { type: 'playlist', playlist, completeness: 'complete' };
    } catch (err: unknown) {
      return {
        type: 'playlist',
        playlist: {
          id,
          uri: `spotify:playlist:${id}`,
          name: 'Unavailable playlist',
        },
        completeness: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getPlaylistTracks(
    id: string,
    offset = 0,
    limit = 100,
  ): Promise<EntityPageResult<CatalogTrackT>> {
    try {
      const json = await this.transport.request(
        `/playlists/${id}/tracks?offset=${offset}&limit=${limit}`,
      );
      const items = toArray(pickObjectKey(json, 'items'));
      const tracks: CatalogTrackT[] = [];
      for (const item of items) {
        const inner =
          item !== null && typeof item === 'object' && 'track' in (item as Record<string, unknown>)
            ? (item as { track: unknown }).track
            : item;
        const mapped = mapTrack(inner);
        if (mapped) tracks.push(mapped);
      }
      const total =
        typeof (json as { total?: unknown })?.total === 'number'
          ? (json as { total: number }).total
          : tracks.length;
      return {
        items: tracks,
        total,
        offset,
        limit,
        hasMore: offset + tracks.length < total,
      };
    } catch {
      return { items: [], total: 0, offset, limit, hasMore: false };
    }
  }

  async getUserTopTracks(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit = 5,
  ): Promise<CatalogTrackT[]> {
    try {
      const json = await this.transport.request(
        `/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
      );
      const items = toArray(pickObjectKey(json, 'items'));
      const tracks: CatalogTrackT[] = [];
      for (const item of items) {
        const mapped = mapTrack(item);
        if (mapped) tracks.push(mapped);
      }
      return tracks;
    } catch {
      return [];
    }
  }

  async getUserTopArtists(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit = 5,
  ): Promise<CatalogArtistT[]> {
    try {
      const json = await this.transport.request(
        `/me/top/artists?time_range=${timeRange}&limit=${limit}`,
      );
      const items = toArray(pickObjectKey(json, 'items'));
      const artists: CatalogArtistT[] = [];
      for (const item of items) {
        const mapped = mapArtist(item);
        if (mapped) artists.push(mapped);
      }
      return artists;
    } catch {
      return [];
    }
  }

  async getRecentlyPlayed(limit = 20): Promise<Array<{ track: CatalogTrackT; playedAt: string }>> {
    try {
      const json = await this.transport.request(`/me/player/recently-played?limit=${limit}`);
      const items = toArray(pickObjectKey(json, 'items'));
      const result: Array<{ track: CatalogTrackT; playedAt: string }> = [];
      for (const item of items) {
        if (item === null || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const track = mapTrack(rec.track);
        if (!track) continue;
        const playedAt = typeof rec.played_at === 'string' ? rec.played_at : '';
        result.push({ track, playedAt });
      }
      return result;
    } catch {
      return [];
    }
  }
}
