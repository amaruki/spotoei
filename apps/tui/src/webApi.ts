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
    if (!nextPage) break;
    current = combine(current, nextPage);
    nextUrl = getNextUrl(nextPage);
    pages++;
  }
  return current;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  invalidateToken?(): void;
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

interface RawPage {
  items?: unknown[];
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  next?: unknown;
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
  tracks?: RawPage;
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
  tracks?: RawPage;
  albums?: RawPage;
  artists?: RawPage;
  playlists?: RawPage;
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
    paramsOrBody: unknown = {},
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  ): Promise<unknown> {
    const isGet = method === 'GET';
    let urlStr = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    let bodyStr: string | undefined;
    if (isGet) {
      if (paramsOrBody && typeof paramsOrBody === 'object') {
        const url = new URL(urlStr);
        for (const [k, v] of Object.entries(paramsOrBody as Record<string, string>)) {
          url.searchParams.set(k, String(v));
        }
        urlStr = url.toString();
      }
    } else if (paramsOrBody && typeof paramsOrBody === 'object' && Object.keys(paramsOrBody).length > 0) {
      bodyStr = JSON.stringify(paramsOrBody);
    }

    const cacheKey = `${method} ${urlStr}`;
    if (isGet && this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const doFetch = async (retryCount = 0): Promise<unknown> => {
      const token = await this.tokenProvider.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'spotoei/0.0.0',
      };
      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(urlStr, {
        method,
        headers,
        ...(bodyStr ? { body: bodyStr } : {}),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let detail = res.statusText;
        try {
          const parsed = JSON.parse(errBody) as { error?: { message?: string } | string };
          if (typeof parsed?.error === 'object' && parsed.error?.message) {
            detail = parsed.error.message;
          } else if (typeof parsed?.error === 'string') {
            detail = parsed.error;
          } else if (errBody.trim()) {
            detail = errBody.trim();
          }
        } catch {
          if (errBody.trim()) {
            detail = errBody.trim();
          }
        }

        // 401 Unauthorized: invalidate token and retry once
        if (res.status === 401 && retryCount === 0) {
          this.tokenProvider.invalidateToken?.();
          return doFetch(retryCount + 1);
        }
        if (res.status === 401) {
          throw new Error(`AUTH_EXPIRED: 401 Unauthorized (${detail})`);
        }

        // 429 Too Many Requests: wait Retry-After seconds and retry once
        if (res.status === 429 && retryCount === 0) {
          const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '1', 10);
          const baseWaitMs = Math.min(10000, Math.max(1, isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000);
          const isBun = 'Bun' in globalThis;
          const waitMs = isBun ? Math.min(50, baseWaitMs) : baseWaitMs;
          await new Promise((r) => setTimeout(r, waitMs));
          return doFetch(retryCount + 1);
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          throw new Error(
            `RATE_LIMITED: 429 Too Many Requests (retry after ${retryAfter ?? 'unknown'}s)`,
          );
        }

        if (res.status === 403) {
          throw new Error(`FORBIDDEN: 403 Forbidden (${detail})`);
        }
        throw new Error(`HTTP_${res.status}: ${detail}`);
      }

      if (res.status === 204) {
        return null;
      }
      const text = await res.text();
      if (!text.trim()) {
        return null;
      }
      return JSON.parse(text);
    };

    const p = (async () => {
      try {
        return await doFetch();
      } finally {
        if (isGet) {
          this.inFlight.delete(cacheKey);
        }
      }
    })();

    if (isGet) {
      this.inFlight.set(cacheKey, p);
    }
    return p;
  }

  // --- Search ---

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
      const json = await this.request('/search', {
        q: query,
        type: types.join(','),
        limit: String(safeLimit),
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

      if (collection === 'followed_artists') {
        const json = await this.request(`/me/following?type=artist&limit=${safeLimit}`);
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
            const next = await this.request(url);
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
          const mapped = this.mapArtist(item);
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
    const path =
      type === 'track'
        ? `/me/tracks?ids=${encodeURIComponent(id)}`
        : `/me/albums?ids=${encodeURIComponent(id)}`;
    try {
      await this.request(path, {}, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  async removeItem(type: 'track' | 'album', id: string): Promise<boolean> {
    const path =
      type === 'track'
        ? `/me/tracks?ids=${encodeURIComponent(id)}`
        : `/me/albums?ids=${encodeURIComponent(id)}`;
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
      const isTrack =
        currentlyPlayingRaw &&
        (pickObjectKey(currentlyPlayingRaw, 'currently_playing_type') === 'track' ||
          !pickObjectKey(currentlyPlayingRaw, 'currently_playing_type'));
      const current = isTrack ? this.mapTrack(currentlyPlayingRaw) : null;
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
      const json = await this.request(`/recommendations?${params.toString()}`);
      const rawTracks = toArray(pickObjectKey(json, 'tracks'));
      const tracks: CatalogTrackT[] = [];
      for (const item of rawTracks) {
        const mapped = this.mapTrack(item);
        if (mapped) tracks.push(mapped);
      }
      return tracks;
    } catch {
      return [];
    }
  }

  // --- Playback / Spotify Connect Operations ---

  async play(opts: { uris?: string[]; context_uri?: string; position_ms?: number; device_id?: string }): Promise<void> {
    const query = opts.device_id ? `?device_id=${encodeURIComponent(opts.device_id)}` : '';
    const body: Record<string, unknown> = {};
    if (opts.uris) body.uris = opts.uris;
    if (opts.context_uri) body.context_uri = opts.context_uri;
    if (typeof opts.position_ms === 'number') body.position_ms = opts.position_ms;
    await this.request(`/me/player/play${query}`, body, 'PUT');
  }

  async pause(): Promise<void> {
    await this.request('/me/player/pause', {}, 'PUT');
  }

  async nextTrack(): Promise<void> {
    await this.request('/me/player/next', {}, 'POST');
  }

  async previousTrack(): Promise<void> {
    await this.request('/me/player/previous', {}, 'POST');
  }

  async seek(positionMs: number): Promise<void> {
    await this.request(`/me/player/seek?position_ms=${Math.max(0, Math.floor(positionMs))}`, {}, 'PUT');
  }

  async setVolume(volumePercent: number): Promise<void> {
    const vol = Math.min(100, Math.max(0, Math.round(volumePercent)));
    await this.request(`/me/player/volume?volume_percent=${vol}`, {}, 'PUT');
  }

  async shuffle(state: boolean): Promise<void> {
    await this.request(`/me/player/shuffle?state=${Boolean(state)}`, {}, 'PUT');
  }

  async repeat(state: 'off' | 'track' | 'context'): Promise<void> {
    await this.request(`/me/player/repeat?state=${state}`, {}, 'PUT');
  }

  async getPlaybackState(): Promise<Record<string, unknown> | null> {
    try {
      const json = await this.request('/me/player');
      return json as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  async getDevices(): Promise<Array<{ id: string; name: string; is_active: boolean; type: string }>> {
    try {
      const json = await this.request('/me/player/devices');
      if (json && typeof json === 'object' && 'devices' in json && Array.isArray((json as Record<string, unknown>).devices)) {
        return (json as { devices: Array<{ id: string; name: string; is_active: boolean; type: string }> }).devices;
      }
    } catch {
      // ignore
    }
    return [];
  }

  async transferPlayback(deviceId: string, play = true): Promise<void> {
    await this.request('/me/player', { device_ids: [deviceId], play }, 'PUT');
  }

  async getArtistGenres(artistId: string): Promise<string[]> {
    if (!artistId || artistId === 'unknown') return [];
    try {
      const json = await this.request(`/artists/${artistId}`);
      if (json && typeof json === 'object' && 'genres' in json && Array.isArray((json as Record<string, unknown>).genres)) {
        return (json as { genres: string[] }).genres;
      }
    } catch {
      // ignore
    }
    return [];
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
