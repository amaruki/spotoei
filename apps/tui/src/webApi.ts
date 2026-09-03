// Web API client behind a SPOTOEI-owned adapter.
// Uses native `fetch` and maps raw Spotify API responses to SPOTOEI domain
// types. Endpoints are not visible outside this module.
//
// Raw Spotify payloads enter as `unknown`. They are validated exactly once
// at the boundary by the `spotoei-protocol` zod schemas; the typed output
// is the only thing the rest of the TUI sees.

import {
  CatalogAlbum as AlbumSchema,
  CatalogArtist as ArtistSchema,
  CatalogPlaylist as PlaylistSchema,
  CatalogTrack as TrackSchema,
  type CatalogAlbumT,
  type CatalogArtistT,
  type CatalogPlaylistT,
  type CatalogTrackT,
  type EntityViewResponseT,
  type LibraryPageResponseT,
  type QueueItemT,
  type QueueSnapshotT,
  type SearchResponseT,
} from 'spotoei-protocol';
export async function followNextCursor<T>(
  first: T,
  fetchNext: (url: string) => Promise<T | null>,
  getNextUrl: (page: T) => string | undefined | null,
  combine: (accum: T, page: T) => T,
  maxPages = 5,
): Promise<T> {
  let current = first;
  let pages = 1;
  let nextUrl = getNextUrl(current);
  while (nextUrl && pages < maxPages) {
    // eslint-disable-next-line no-await-in-loop
    const nextPage = await fetchNext(nextUrl);
    current = combine(current, nextPage);
    nextUrl = getNextUrl(nextPage);
    pages++;
  }
  return current;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}
export interface WebApiClientOptions {
  tokenProvider: TokenProvider;
  baseUrl?: string;
}

// --- Domain candidates parsed once at the boundary ---

interface RawArtistRef {
  id?: unknown;
  name?: unknown;
  uri?: unknown;
}

interface RawImageRef {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface RawAlbumRef {
  id?: unknown;
  name?: unknown;
  images?: unknown;
}

interface RawTrack {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  artists?: unknown;
  album?: unknown;
  duration_ms?: unknown;
  explicit?: unknown;
  is_playable?: unknown;
}

interface RawAlbum {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  artists?: unknown;
  images?: unknown;
  release_date?: unknown;
  total_tracks?: unknown;
  album_type?: unknown;
  tracks?: unknown;
}

interface RawArtist {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  images?: unknown;
  genres?: unknown;
  followers?: unknown;
}

interface RawPlaylist {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  description?: unknown;
  owner?: unknown;
  images?: unknown;
  tracks?: unknown;
  public?: unknown;
  collaborative?: unknown;
}

interface RawSearchResponse {
  tracks?: unknown;
  albums?: unknown;
  artists?: unknown;
  playlists?: unknown;
}

export class WebApiClient {
  private tokenProvider: TokenProvider;
  private baseUrl: string;
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(opts: WebApiClientOptions) {
    this.tokenProvider = opts.tokenProvider;
    this.baseUrl = opts.baseUrl ?? 'https://api.spotify.com/v1';
  }

  private async request(
    path: string,
    params: Record<string, string> = {},
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const cacheKey = `${method} ${url.toString()}`;

    if (method === 'GET' && this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const p = (async () => {
      try {
        const token = await this.tokenProvider.getAccessToken();
        const res = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'spotoei/0.0.0',
          },
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('AUTH_EXPIRED: 401 Unauthorized');
          }
          if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After');
            throw new Error(
              `RATE_LIMITED: 429 Too Many Requests (retry after ${retryAfter ?? 'unknown'}s)`,
            );
          }
          if (res.status === 403) {
            throw new Error('FORBIDDEN: 403 Forbidden');
          }
          throw new Error(`HTTP_${res.status}: ${res.statusText}`);
        }

        if (res.status === 204) {
          return null;
        }
        const text = await res.text();
        if (!text.trim()) {
          return null;
        }
        return JSON.parse(text);
      } finally {
        if (method === 'GET') {
          this.inFlight.delete(cacheKey);
        }
      }
    })();

    if (method === 'GET') {
      this.inFlight.set(cacheKey, p);
    }
    return p;
  }

  // --- Search ---

  async search(
    query: string,
    types: Array<'track' | 'album' | 'artist' | 'playlist'> = ['track'],
    limit = 20,
  ): Promise<SearchResponseT> {
    if (!query.trim()) {
      return { query, hits: [] };
    }

    try {
      const json = await this.request('/search', {
        q: query,
        type: types.join(','),
        limit: String(limit),
      });

      const root = toSearchResponse(json);
      const hits: SearchResponseT['hits'] = [];

      const trackList = toArray(root.tracks?.items);
      for (const raw of trackList) {
        const mapped = this.mapTrack(raw);
        if (mapped) hits.push({ type: 'track', track: mapped });
      }

      const albumList = toArray(root.albums?.items);
      for (const raw of albumList) {
        const mapped = this.mapAlbum(raw);
        if (mapped) hits.push({ type: 'album', album: mapped });
      }

      const artistList = toArray(root.artists?.items);
      for (const raw of artistList) {
        const mapped = this.mapArtist(raw);
        if (mapped) hits.push({ type: 'artist', artist: mapped });
      }

      const playlistList = toArray(root.playlists?.items);
      for (const raw of playlistList) {
        if (raw === null) continue;
        const mapped = this.mapPlaylist(raw);
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

  // --- Entity Views ---

  async getTrackView(id: string): Promise<EntityViewResponseT> {
    try {
      const json = await this.request(`/tracks/${id}`);
      const track = this.mapTrack(json);
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
      const json = await this.request(`/albums/${id}`);
      const album = this.mapAlbum(json);
      if (!album) throw new Error('invalid album payload');

      const raw = toAlbum(json);
      const tracks: CatalogTrackT[] = [];
      const trackList = toArray(raw.tracks?.items);
      for (const t of trackList) {
        const mapped = this.mapTrack(t);
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

  // --- Mappers: shape verification + boundary parse ---

  private mapTrack(raw: unknown): CatalogTrackT | null {
    if (raw === null || typeof raw !== 'object') return null;
    const candidate = raw as RawTrack;
    if (typeof candidate.id !== 'string') return null;

    const id = candidate.id;
    const artistList = toArtistList(candidate.artists);
    const albumRef = toAlbumRef(candidate.album);
    const firstImg = toFirstImage(albumRef.images);
    const durationMs = typeof candidate.duration_ms === 'number' ? candidate.duration_ms : 0;
    const isExplicit = typeof candidate.explicit === 'boolean' ? candidate.explicit : undefined;
    const isPlayable =
      typeof candidate.is_playable === 'boolean' ? candidate.is_playable : undefined;

    const track = {
      id,
      uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:track:${id}`,
      name: typeof candidate.name === 'string' ? candidate.name : 'Untitled',
      artists: artistList,
      albumId: albumRef.id,
      albumName: albumRef.name,
      durationMs,
      image: firstImg,
      isExplicit,
      isPlayable,
    };
    const parsed = TrackSchema.safeParse(track);
    return parsed.success ? parsed.data : null;
  }

  private mapAlbum(raw: unknown): CatalogAlbumT | null {
    if (raw === null || typeof raw !== 'object') return null;
    const candidate = raw as RawAlbum;
    if (typeof candidate.id !== 'string') return null;

    const id = candidate.id;
    const artistList = toArtistList(candidate.artists);
    const firstImg = toFirstImage(candidate.images);
    const releaseDate =
      typeof candidate.release_date === 'string' ? candidate.release_date : undefined;
    const totalTracks =
      typeof candidate.total_tracks === 'number' ? candidate.total_tracks : undefined;
    const albumType =
      candidate.album_type === 'album' ||
      candidate.album_type === 'single' ||
      candidate.album_type === 'compilation'
        ? candidate.album_type
        : undefined;

    const album = {
      id,
      uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:album:${id}`,
      name: typeof candidate.name === 'string' ? candidate.name : 'Untitled Album',
      artists: artistList,
      image: firstImg,
      releaseDate,
      totalTracks,
      albumType,
    };
    const parsed = AlbumSchema.safeParse(album);
    return parsed.success ? parsed.data : null;
  }

  private mapArtist(raw: unknown): CatalogArtistT | null {
    if (raw === null || typeof raw !== 'object') return null;
    const candidate = raw as RawArtist;
    if (typeof candidate.id !== 'string') return null;

    const id = candidate.id;
    const firstImg = toFirstImage(candidate.images);
    const genres = Array.isArray(candidate.genres)
      ? candidate.genres.filter((g): g is string => typeof g === 'string')
      : undefined;
    const followersObj =
      candidate.followers !== null && typeof candidate.followers === 'object'
        ? (candidate.followers as { total?: unknown })
        : null;
    const followers =
      followersObj && typeof followersObj.total === 'number' ? followersObj.total : undefined;

    const artist = {
      id,
      uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:artist:${id}`,
      name: typeof candidate.name === 'string' ? candidate.name : 'Unknown Artist',
      image: firstImg,
      genres,
      followers,
    };
    const parsed = ArtistSchema.safeParse(artist);
    return parsed.success ? parsed.data : null;
  }

  private mapPlaylist(raw: unknown): CatalogPlaylistT | null {
    if (raw === null || typeof raw !== 'object') return null;
    const candidate = raw as RawPlaylist;
    if (typeof candidate.id !== 'string') return null;

    const id = candidate.id;
    const firstImg = toFirstImage(candidate.images);

    const ownerObj =
      candidate.owner !== null && typeof candidate.owner === 'object'
        ? (candidate.owner as { id?: unknown; display_name?: unknown })
        : null;
    const owner =
      ownerObj && typeof ownerObj.id === 'string'
        ? {
            id: ownerObj.id,
            name: typeof ownerObj.display_name === 'string' ? ownerObj.display_name : ownerObj.id,
          }
        : undefined;

    const tracksObj =
      candidate.tracks !== null && typeof candidate.tracks === 'object'
        ? (candidate.tracks as { total?: unknown })
        : null;
    const trackCount =
      tracksObj && typeof tracksObj.total === 'number' ? tracksObj.total : undefined;

    const isPublic = typeof candidate.public === 'boolean' ? candidate.public : undefined;
    const isCollaborative =
      typeof candidate.collaborative === 'boolean' ? candidate.collaborative : undefined;

    const playlist = {
      id,
      uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:playlist:${id}`,
      name: typeof candidate.name === 'string' ? candidate.name : 'Untitled Playlist',
      description: typeof candidate.description === 'string' ? candidate.description : undefined,
      owner,
      image: firstImg,
      trackCount,
      isPublic,
      isCollaborative,
    };
    const parsed = PlaylistSchema.safeParse(playlist);
    return parsed.success ? parsed.data : null;
  }

  // --- Library Views & Pagination ---

  async getLibraryPage(
    collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
    offset = 0,
    limit = 20,
  ): Promise<LibraryPageResponseT> {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const safeOffset = Math.max(0, offset);

    try {
      if (collection === 'saved_tracks') {
        const json = await this.request(`/me/tracks?offset=${safeOffset}&limit=${safeLimit}`);
        const rawItems = toArray(pickObjectKey(json, 'items'));
        const tracks: CatalogTrackT[] = [];
        for (const item of rawItems) {
          if (item !== null && typeof item === 'object' && 'track' in item) {
            const track = (item as { track: unknown }).track;
            const mapped = this.mapTrack(track);
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

      if (collection === 'saved_albums') {
        const json = await this.request(`/me/albums?offset=${safeOffset}&limit=${safeLimit}`);
        const rawItems = toArray(pickObjectKey(json, 'items'));
        const albums: CatalogAlbumT[] = [];
        for (const item of rawItems) {
          if (item !== null && typeof item === 'object' && 'album' in item) {
            const album = (item as { album: unknown }).album;
            const mapped = this.mapAlbum(album);
            if (mapped) albums.push(mapped);
          }
        }
        const total = readNumber(json, 'total', albums.length);
        return {
          collection,
          items: albums,
          total,
          offset: safeOffset,
          limit: safeLimit,
          hasMore: safeOffset + albums.length < total,
        };
      }

      if (collection === 'followed_artists') {
        const json = await this.request(`/me/following?type=artist&limit=${safeLimit}`);
        const artistsObj =
          json !== null && typeof json === 'object' && 'artists' in json
            ? (json as { artists: unknown }).artists
            : null;
        const rawItems = toArray(
          artistsObj !== null && typeof artistsObj === 'object' && 'items' in artistsObj
            ? (artistsObj as { items: unknown }).items
            : undefined,
        );
        const artists: CatalogArtistT[] = [];
        for (const item of rawItems) {
          const mapped = this.mapArtist(item);
          if (mapped) artists.push(mapped);
        }
        const total =
          artistsObj !== null && typeof artistsObj === 'object' && 'total' in artistsObj
            ? typeof (artistsObj as { total: unknown }).total === 'number'
              ? (artistsObj as { total: number }).total
              : artists.length
            : artists.length;
        return {
          collection,
          items: artists,
          total,
          offset: safeOffset,
          limit: safeLimit,
          hasMore: safeOffset + artists.length < total,
        };
      }

      if (collection === 'playlists') {
        const json = await this.request(`/me/playlists?offset=${safeOffset}&limit=${safeLimit}`);
        const rawItems = toArray(pickObjectKey(json, 'items'));
        const playlists: CatalogPlaylistT[] = [];
        for (const item of rawItems) {
          const mapped = this.mapPlaylist(item);
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

  // --- Library Save / Remove Mutations ---

  async saveItem(type: 'track' | 'album', id: string): Promise<boolean> {
    const path = type === 'track' ? `/me/tracks?ids=${id}` : `/me/albums?ids=${id}`;
    try {
      await this.request(path, {}, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  async removeItem(type: 'track' | 'album', id: string): Promise<boolean> {
    const path = type === 'track' ? `/me/tracks?ids=${id}` : `/me/albums?ids=${id}`;
    try {
      await this.request(path, {}, 'DELETE');
      return true;
    } catch {
      return false;
    }
  }

  // --- Queue Operations ---

  async addToQueue(uri: string): Promise<boolean> {
    try {
      await this.request(`/me/player/queue?uri=${encodeURIComponent(uri)}`, {}, 'POST');
      return true;
    } catch {
      return false;
    }
  }

  async getQueueSnapshot(): Promise<QueueSnapshotT | null> {
    try {
      const json = await this.request('/me/player/queue');
      const currentlyPlayingRaw = pickObjectKey(json, 'currently_playing');
      const current = currentlyPlayingRaw ? this.mapTrack(currentlyPlayingRaw) : null;
      const rawQueue = toArray(pickObjectKey(json, 'queue'));
      const upcoming: QueueItemT[] = [];
      let idx = 0;
      for (const item of rawQueue) {
        const track = this.mapTrack(item);
        if (track) {
          upcoming.push({
            id: `${track.id}-${idx++}`,
            track,
            source: 'context',
            addedAt: Date.now(),
          });
        }
      }
      return {
        current,
        upcoming,
        revision: 0,
      };
    } catch {
      return null;
    }
  }
}

// --- Targeted, used-once shaping helpers ---

function toSearchResponse(raw: unknown): RawSearchResponse {
  if (raw === null || typeof raw !== 'object') return {};
  return raw as RawSearchResponse;
}

function toAlbum(raw: unknown): RawAlbum {
  if (raw === null || typeof raw !== 'object') return {};
  return raw as RawAlbum;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toArtistList(value: unknown): CatalogTrackT['artists'] {
  if (!Array.isArray(value)) {
    return [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }];
  }
  const out = value
    .filter((a): a is RawArtistRef => a !== null && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : 'unknown',
      name: typeof a.name === 'string' ? a.name : 'Unknown',
      uri:
        typeof a.uri === 'string'
          ? a.uri
          : `spotify:artist:${typeof a.id === 'string' ? a.id : 'unknown'}`,
    }));
  return out.length > 0 ? out : [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }];
}

function toAlbumRef(value: unknown): RawAlbumRef {
  if (value === null || typeof value !== 'object') return {};
  return value as RawAlbumRef;
}

function toFirstImage(value: unknown): CatalogTrackT['image'] {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const img = entry as RawImageRef;
    if (typeof img.url !== 'string') continue;
    return {
      url: img.url,
      width: typeof img.width === 'number' ? img.width : undefined,
      height: typeof img.height === 'number' ? img.height : undefined,
    };
  }
  return undefined;
}

function pickObjectKey(obj: unknown, key: string): unknown {
  if (obj !== null && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function readNumber(obj: unknown, key: string, fallback: number): number {
  const v = pickObjectKey(obj, key);
  return typeof v === 'number' ? v : fallback;
}
