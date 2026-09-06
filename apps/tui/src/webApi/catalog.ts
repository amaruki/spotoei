// Catalog and search endpoints (search, track view, album view, recommendations).

import type {
  CatalogEpisodeT,
  CatalogShowT,
  CatalogTrackT,
  EntityViewResponseT,
  SearchResponseT,
} from 'spotoei-protocol';
import { mapAlbum, mapArtist, mapEpisode, mapPlaylist, mapShow, mapTrack } from './mappers';
import { pickObjectKey, toAlbum, toArray, toSearchResponse } from './shape';
import { ApiError, type Transport } from './transport';

function isForbiddenError(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === 'FORBIDDEN' || error.status === 403;
  const msg = error instanceof Error ? error.message : String(error);
  return /FORBIDDEN/.test(msg) || /\b403\b/.test(msg);
}

export class CatalogEndpoints {
  constructor(private transport: Transport) {}

  async search(
    query: string,
    types: Array<'track' | 'album' | 'artist' | 'playlist' | 'show' | 'episode'> = [
      'track',
      'album',
      'artist',
      'playlist',
      'show',
      'episode',
    ],
    limit = 10,
    signal?: AbortSignal,
  ): Promise<SearchResponseT> {
    if (!query.trim()) {
      return { query, hits: [] };
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const safeLimit = Math.min(Math.max(1, limit), 10);

    try {
      const json = await this.transport.request(
        '/search',
        {
          q: query,
          type: types.join(','),
          limit: String(safeLimit),
        },
        'GET',
        signal,
      );

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

      const showList = toArray(root.shows?.items);
      const showsItems: CatalogShowT[] = [];
      for (const raw of showList) {
        if (raw === null) continue;
        const mapped = mapShow(raw);
        if (mapped) {
          showsItems.push(mapped);
          hits.push({ type: 'show', show: mapped });
        }
      }

      const episodeList = toArray(root.episodes?.items);
      const episodesItems: CatalogEpisodeT[] = [];
      for (const raw of episodeList) {
        if (raw === null) continue;
        const mapped = mapEpisode(raw);
        if (mapped) {
          episodesItems.push(mapped);
          hits.push({ type: 'episode', episode: mapped });
        }
      }

      return {
        query,
        hits,
        shows: root.shows
          ? {
              items: showsItems,
              total: typeof root.shows.total === 'number' ? root.shows.total : showsItems.length,
              limit: typeof root.shows.limit === 'number' ? root.shows.limit : safeLimit,
              offset: typeof root.shows.offset === 'number' ? root.shows.offset : 0,
            }
          : undefined,
        episodes: root.episodes
          ? {
              items: episodesItems,
              total: typeof root.episodes.total === 'number' ? root.episodes.total : episodesItems.length,
              limit: typeof root.episodes.limit === 'number' ? root.episodes.limit : safeLimit,
              offset: typeof root.episodes.offset === 'number' ? root.episodes.offset : 0,
            }
          : undefined,
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
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
        query,
        hits: [],
        error: {
          code,
          message: msg,
          retryable: code !== 'AUTH_EXPIRED' && code !== 'FORBIDDEN' && code !== 'QUOTA_EXCEEDED',
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
    const safeLimit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20) || 20));
    const seedTracks = (opts.seedTracks ?? []).filter(Boolean).slice(0, 5);
    const seedArtists = (opts.seedArtists ?? []).filter(Boolean).slice(0, 5);
    const seedGenres = (opts.seedGenres ?? []).filter(Boolean).slice(0, 5);
    if (seedTracks.length === 0 && seedArtists.length === 0 && seedGenres.length === 0) {
      return [];
    }

    const params = new URLSearchParams();
    if (seedTracks.length > 0) params.set('seed_tracks', seedTracks.join(','));
    if (seedArtists.length > 0) params.set('seed_artists', seedArtists.join(','));
    if (seedGenres.length > 0) params.set('seed_genres', seedGenres.join(','));
    params.set('limit', String(safeLimit));

    try {
      const json = await this.transport.request(`/recommendations?${params.toString()}`);
      const rawTracks = toArray(pickObjectKey(json, 'tracks'));
      const tracks: CatalogTrackT[] = [];
      for (const item of rawTracks) {
        const mapped = mapTrack(item);
        if (mapped) tracks.push(mapped);
      }
      if (tracks.length > 0) return tracks.slice(0, safeLimit);
    } catch {
      // Deprecated for dev apps without Extended Quota (404) — fall through
      // to the artist top-tracks fallback below instead of returning empty.
    }
    return this.getTopTracksFallback(seedTracks, seedArtists, safeLimit);
  }

  // Fallback for the deprecated /recommendations endpoint (404 for dev apps
  // without Extended Quota since Nov 2024). Resolves seed tracks to their
  // artists, then fans out to /artists/{id}/top-tracks.
  private async getTopTracksFallback(
    seedTracks: string[],
    seedArtists: string[],
    limit: number,
  ): Promise<CatalogTrackT[]> {
    const artistIds: string[] = [];
    const seenArtists = new Set<string>();
    const pushArtist = (id: string): void => {
      if (!id || seenArtists.has(id) || artistIds.length >= 5) return;
      seenArtists.add(id);
      artistIds.push(id);
    };
    for (const id of seedArtists) pushArtist(id);
    // Resolve seed tracks to artists (best effort, capped to bound requests).
    for (const trackId of seedTracks) {
      if (artistIds.length >= 5) break;
      try {
        const json = await this.transport.request(`/tracks/${encodeURIComponent(trackId)}`);
        const rawArtists =
          json !== null && typeof json === 'object'
            ? (json as { artists?: unknown }).artists
            : undefined;
        const list = toArray(rawArtists);
        for (const entry of list) {
          if (entry !== null && typeof entry === 'object') {
            const id = (entry as { id?: unknown }).id;
            if (typeof id === 'string') pushArtist(id);
          }
          if (artistIds.length >= 5) break;
        }
      } catch {
        // Ignore per-track lookup failures; other seeds may still resolve.
      }
    }
    if (artistIds.length === 0) return [];

    const excluded = new Set(seedTracks);
    const tracks: CatalogTrackT[] = [];
    const seenTracks = new Set<string>();
    for (const artistId of artistIds) {
      if (tracks.length >= limit) break;
      try {
        const json = await this.transport.request(
          `/artists/${encodeURIComponent(artistId)}/top-tracks?market=from_token`,
        );
        for (const item of toArray(pickObjectKey(json, 'tracks'))) {
          const mapped = mapTrack(item);
          if (!mapped || seenTracks.has(mapped.id) || excluded.has(mapped.id)) continue;
          seenTracks.add(mapped.id);
          tracks.push(mapped);
          if (tracks.length >= limit) break;
        }
      } catch (error) {
        // A 403 here is an app-wide restriction (dev apps without Extended
        // Quota): every artist would fail identically, so stop fanning out.
        // Other failures stay local; remaining artists may still deliver.
        if (isForbiddenError(error)) break;
      }
    }
    return tracks;
  }
}
