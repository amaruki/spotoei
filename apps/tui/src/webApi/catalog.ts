// Catalog and search endpoints (search, track view, album view, recommendations).

import type {
  CatalogTrackT,
  EntityViewResponseT,
  SearchResponseT,
} from 'spotoei-protocol';
import { mapAlbum, mapArtist, mapPlaylist, mapTrack } from './mappers';
import { pickObjectKey, toAlbum, toArray, toSearchResponse } from './shape';
import type { Transport } from './transport';

export class CatalogEndpoints {
  constructor(private transport: Transport) {}

  async search(
    query: string,
    types: Array<'track' | 'album' | 'artist' | 'playlist'> = [
      'track',
      'album',
      'artist',
      'playlist',
    ],
    limit = 10,
  ): Promise<SearchResponseT> {
    if (!query.trim()) {
      return { query, hits: [] };
    }

    // Spotify restricts search limit to max 10; values > 10 return 400 Bad Request ("Invalid limit")
    const safeLimit = Math.min(Math.max(1, limit), 10);

    try {
      const json = await this.transport.request('/search', {
        q: query,
        type: types.join(','),
        limit: String(safeLimit),
      });

      const root = toSearchResponse(json);
      const hits: SearchResponseT['hits'] = [];

      const trackList = toArray(root.tracks?.items);
      for (const raw of trackList) {
        const mapped = mapTrack(raw);
        if (mapped) hits.push({ type: 'track', track: mapped });
      }

      const albumList = toArray(root.albums?.items);
      for (const raw of albumList) {
        const mapped = mapAlbum(raw);
        if (mapped) hits.push({ type: 'album', album: mapped });
      }

      const artistList = toArray(root.artists?.items);
      for (const raw of artistList) {
        const mapped = mapArtist(raw);
        if (mapped) hits.push({ type: 'artist', artist: mapped });
      }

      const playlistList = toArray(root.playlists?.items);
      for (const raw of playlistList) {
        if (raw === null) continue;
        const mapped = mapPlaylist(raw);
        if (mapped) hits.push({ type: 'playlist', playlist: mapped });
      }

      return { query, hits };
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
        query,
        hits: [],
        error: {
          code,
          message: msg,
          retryable: code !== 'AUTH_EXPIRED' && code !== 'FORBIDDEN',
        },
      };
    }
  }

  async getTrackView(id: string): Promise<EntityViewResponseT> {
    try {
      const json = await this.transport.request(`/tracks/${id}`);
      const track = mapTrack(json);
      if (!track) throw new Error('invalid track payload');
      return { type: 'track', track, completeness: 'complete' };
    } catch (err: unknown) {
      return {
        type: 'track',
        track: {
          id,
          uri: `spotify:track:${id}`,
          name: 'Unavailable track',
          artists: [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }],
          durationMs: 0,
        },
        completeness: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getAlbumView(id: string): Promise<EntityViewResponseT> {
    try {
      const json = await this.transport.request(`/albums/${id}`);
      const album = mapAlbum(json);
      if (!album) throw new Error('invalid album payload');

      const raw = toAlbum(json);
      const tracks: CatalogTrackT[] = [];
      const trackList = toArray(raw.tracks?.items);
      for (const t of trackList) {
        const mapped = mapTrack(t);
        if (mapped) tracks.push(mapped);
      }

      return { type: 'album', album, tracks, completeness: 'complete' };
    } catch (err: unknown) {
      return {
        type: 'album',
        album: {
          id,
          uri: `spotify:album:${id}`,
          name: 'Unavailable album',
          artists: [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }],
        },
        completeness: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getRecommendations(opts: {
    seedTracks?: string[];
    seedArtists?: string[];
    seedGenres?: string[];
    limit?: number;
  }): Promise<CatalogTrackT[]> {
    const params = new URLSearchParams();
    if (opts.seedTracks && opts.seedTracks.length > 0) {
      params.set('seed_tracks', opts.seedTracks.slice(0, 5).join(','));
    }
    if (opts.seedArtists && opts.seedArtists.length > 0) {
      params.set('seed_artists', opts.seedArtists.slice(0, 5).join(','));
    }
    if (opts.seedGenres && opts.seedGenres.length > 0) {
      params.set('seed_genres', opts.seedGenres.slice(0, 5).join(','));
    }
    params.set('limit', String(opts.limit ?? 20));

    try {
      const json = await this.transport.request(`/recommendations?${params.toString()}`);
      const rawTracks = toArray(pickObjectKey(json, 'tracks'));
      const tracks: CatalogTrackT[] = [];
      for (const item of rawTracks) {
        const mapped = mapTrack(item);
        if (mapped) tracks.push(mapped);
      }
      return tracks;
    } catch {
      return [];
    }
  }
}
