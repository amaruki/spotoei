// @ts-nocheck
import type { BrowseEntryT, BrowsePathT, SearchResponseT } from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { browseResultsLabel, shouldFetchBrowseEntry } from '../browse/results';
import { getBrowseConfig } from '../config';
import { getDisplayedCategory } from './browseLoadState';

export interface BrowseSearchClient {
  search(
    query: string,
    types?: Array<'track' | 'album' | 'artist' | 'playlist'>,
  ): Promise<SearchResponseT>;
}
export interface BrowseEntityClient {
  loadNewReleases: (limit?: number) => Promise<unknown[]>;
  loadAlbumTracks?: (
    id: string,
    offset?: number,
    limit?: number,
  ) => Promise<{ items: Array<unknown> }>;
  loadRecommendations: (opts: {
    limit?: number;
    seedGenres?: string[];
    seedArtists?: string[];
    seedTracks?: string[];
  }) => Promise<unknown[]>;
  loadPlaylistTracks?: (
    id: string,
    offset?: number,
    limit?: number,
  ) => Promise<{ items: Array<unknown> }>;
}
export type BrowseNav =
  | {
      kind: 'route';
      route:
        | { kind: 'browse'; path: BrowsePathT }
        | { kind: 'playlist'; id: string }
        | { kind: 'library'; section: 'playlists' }
        | { kind: 'queue' }
        | { kind: 'home'; tab: 'for_you' };
      note?: string;
    }
  | { kind: 'message'; text: string; persist?: boolean };

export function isInlineBrowseEntry(entry: BrowseEntryT): boolean {
  const k = (entry.source as unknown as { kind: string }).kind;
  return k === 'new_releases' || k === 'recommendations' || k === 'search';
}

// Rank playlist search hits by query-token overlap with the playlist name
// so a thematic entry prefers an on-theme playlist ("Top Hits Global" for
// `top hits`) over an incidental text match ("EPIKASE SONG BATTLE").
// Stable: ties keep Spotify's relevance order.
export function rankPlaylistHits<H extends { playlist: { id: string; uri: string; name: string } }>(
  hits: H[],
  query: string,
): H[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && t !== 'tag' && t !== 'genre' && t !== 'year');
  if (tokens.length === 0) return hits;
  return hits
    .map((hit, index) => {
      const haystack = hit.playlist.name.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      return { hit, score, index };
    })
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.hit);
}

export function resolveBrowseSelection(
  path: { category?: string; entry?: string },
  index: number,
): BrowseNav {
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    const shown = getDisplayedCategory(index);
    // A live-only category has no static counterpart: route straight to
    // its level-2 path instead of misfiring into the static row.
    if (shown && !categories.some((c) => c.id === shown.id)) {
      return { kind: 'route', route: { kind: 'browse', path: { category: shown.id } } };
    }
    const cat = categories[index];
    if (!cat) return { kind: 'message', text: 'Unknown browse category' };
    return { kind: 'route', route: { kind: 'browse', path: { category: cat.id } } };
  }
  const cat = categories.find((c) => c.id === path.category);
  const entry = cat?.entries[index] as BrowseEntryT | undefined;
  if (!entry) return { kind: 'message', text: 'Unknown browse entry' };
  const nav = activateBrowseEntry(entry);
  if (nav.kind === 'route' && nav.route.kind === 'browse') {
    nav.route.path = { category: cat?.id, entry: entry.id };
    nav.note = browseBreadcrumb({ category: cat?.id, entry: entry.id });
  }
  return nav;
}
export function activateBrowseEntry(entry: BrowseEntryT): BrowseNav {
  if (!shouldFetchBrowseEntry(entry))
    return {
      kind: 'message',
      text: `${entry.label} is unavailable — configure sources in Settings, then retry`,
      persist: true,
    };
  const source = entry.source;
  if (
    source.kind === 'new_releases' ||
    source.kind === 'recommendations' ||
    source.kind === 'search'
  )
    return { kind: 'route', route: { kind: 'browse', path: {} } };
  switch (source.kind) {
    case 'playlist': {
      const id = source.playlistUri.split(':').pop() ?? '';
      if (!id)
        return {
          kind: 'message',
          text: `Invalid playlist reference for ${entry.label}`,
          persist: true,
        };
      return { kind: 'route', route: { kind: 'playlist', id }, note: `Browse › ${entry.label}` };
    }
    case 'library':
      return { kind: 'route', route: { kind: 'library', section: 'playlists' } };
    case 'top_artists':
      return { kind: 'route', route: { kind: 'home', tab: 'for_you' } };
    case 'action':
      return { kind: 'route', route: { kind: 'queue' } };
    default:
      return { kind: 'route', route: { kind: 'home', tab: 'for_you' } };
  }
}
export function browseBreadcrumb(path: { category?: string; entry?: string }): string {
  const categories = buildBrowseCategories(getBrowseConfig());
  const cat = categories.find((c) => c.id === path.category);
  const entry = cat?.entries.find((e) => e.id === path.entry);
  return ['Browse', cat?.label, entry?.label].filter(Boolean).join(' › ');
}
export function browseResultLabelFor(entry: BrowseEntryT): string {
  return `${browseResultsLabel(entry)}: ${entry.label}`;
}
export function findBrowseEntry(path: {
  category?: string;
  entry?: string;
}): BrowseEntryT | undefined {
  const categories = buildBrowseCategories(getBrowseConfig());
  const cat = categories.find((c) => c.id === path.category);
  return cat?.entries.find((e) => e.id === path.entry);
}
