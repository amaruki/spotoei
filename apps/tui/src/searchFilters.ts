// Pure in-memory search filtering, hit classification, and the local
// library-search entry point. Extracted from search.ts to keep the client
// under the 300 LoC cap.

import { Cache } from './cache';
import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogEpisodeT,
  CatalogPlaylistT,
  CatalogShowT,
  CatalogTrackT,
  SearchHitT,
  SearchResponseT,
} from 'spotoei-protocol';

let defaultClientState: { cache: Cache; accountId: string } | null = null;

export function setDefaultClientState(state: { cache: Cache; accountId: string } | null): void {
  defaultClientState = state;
}

export function isFuzzyMatch(text: string, pattern: string): boolean {
  let tIdx = 0;
  let pIdx = 0;
  const tLower = text.toLowerCase();
  const pLower = pattern.toLowerCase();
  while (tIdx < tLower.length && pIdx < pLower.length) {
    if (tLower[tIdx] === pLower[pIdx]) {
      pIdx++;
    }
    tIdx++;
  }
  return pIdx === pLower.length;
}

export function filterItemsInMemory<
  T extends { name?: string; artists?: unknown; albumName?: string; publisher?: string },
>(query: string, items: readonly T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const name = (item.name ?? '').toLowerCase();
    let artist = '';
    if (Array.isArray(item.artists)) {
      artist = item.artists
        .map((a: unknown) => {
          if (typeof a === 'string') return a;
          if (a && typeof a === 'object' && 'name' in a) {
            return String((a as { name?: unknown }).name ?? '');
          }
          return '';
        })
        .join(' ')
        .toLowerCase();
    }
    const album = (item.albumName ?? '').toLowerCase();
    const publisher = (item.publisher ?? '').toLowerCase();
    const combined = `${name} ${artist} ${album} ${publisher}`;

    let score = 0;
    if (name === q) {
      score = 1000;
    } else if (name.startsWith(q)) {
      score = 500;
    } else if (name.includes(q)) {
      score = 300;
    } else if (artist.includes(q) || album.includes(q) || publisher.includes(q)) {
      score = 200;
    } else if (tokens.length > 1 && tokens.every((tok) => combined.includes(tok))) {
      score = 150;
    } else if (isFuzzyMatch(name, q)) {
      score = 80;
    } else if (isFuzzyMatch(artist, q) || isFuzzyMatch(album, q)) {
      score = 40;
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  return scored.toSorted((a, b) => b.score - a.score).map((s) => s.item);
}

export function itemToSearchHit(raw: unknown): SearchHitT {
  const item = (raw ?? {}) as Record<string, unknown>;
  const uri = typeof item.uri === 'string' ? item.uri : '';

  if (
    uri.startsWith('spotify:album:') ||
    item.albumType !== undefined ||
    item.totalTracks !== undefined
  ) {
    return { type: 'album', album: item as unknown as CatalogAlbumT };
  }
  if (
    uri.startsWith('spotify:artist:') ||
    (item.followers !== undefined && item.durationMs === undefined)
  ) {
    return { type: 'artist', artist: item as unknown as CatalogArtistT };
  }
  if (
    uri.startsWith('spotify:playlist:') ||
    item.isFolder !== undefined ||
    item.collaborative !== undefined
  ) {
    return { type: 'playlist', playlist: item as unknown as CatalogPlaylistT };
  }
  if (uri.startsWith('spotify:show:') || item.publisher !== undefined) {
    return { type: 'show', show: item as unknown as CatalogShowT };
  }
  if (uri.startsWith('spotify:episode:')) {
    return { type: 'episode', episode: item as unknown as CatalogEpisodeT };
  }
  return { type: 'track', track: item as unknown as CatalogTrackT };
}

export function filterLibraryLocal<T = unknown>(
  query: string,
  cacheOrItems?: Cache | readonly T[] | T[],
  accountId = 'anonymous',
  collections?: string[] | string,
): T[] & SearchResponseT {
  let matched: T[] = [];
  const q = query.trim();

  if (cacheOrItems && typeof (cacheOrItems as Cache).searchLibrary === 'function') {
    matched = (cacheOrItems as Cache).searchLibrary<T>(accountId, q, collections);
  } else if (Array.isArray(cacheOrItems)) {
    matched = filterItemsInMemory(
      q,
      cacheOrItems as readonly {
        name?: string;
        artists?: unknown;
        albumName?: string;
        publisher?: string;
      }[],
    ) as unknown as T[];
  } else if (defaultClientState) {
    matched = defaultClientState.cache.searchLibrary<T>(
      defaultClientState.accountId,
      q,
      collections,
    );
  }

  const result = [...matched] as T[] & SearchResponseT;
  result.query = query;
  result.hits = matched.map((item) => itemToSearchHit(item));
  return result;
}
