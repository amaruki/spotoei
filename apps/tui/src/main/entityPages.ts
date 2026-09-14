// @ts-nocheck
import type { ArtistReleaseGroupT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import type { Ui } from '../ui/types';
import type { AppState } from './types';

export const PAGE_SIZE = 20;
// Spotify caps artist-albums pages at 10 (limit > 10 → 400 "Invalid limit").
export const ARTIST_PAGE_SIZE = 10;
// Parallel background fetch width, mirroring spotify-player's MAX_PARALLEL.
export const PREFETCH_PARALLEL = 8;

export interface EntityLoaderDeps {
  entityManager: EntityManager;
  getUi: () => Ui | null;
  state: AppState;
}

export interface LoadedPage {
  items: unknown[];
  nextOffset: number;
  hasMore: boolean;
  group: string;
}

export function pagesOf(state: AppState): Record<string, LoadedPage> {
  if (!state.entityPages) state.entityPages = {};
  return state.entityPages as Record<string, LoadedPage>;
}

// Tracks loaded for an album/playlist route, for queue-context use. A
// direct play from such a route should continue inside the same list
// instead of jumping to a stale pool head.
export function poolTracksForRoute(state: AppState, route: unknown): CatalogTrackT[] | null {
  if (!route || typeof route !== 'object') return null;
  const r = route as { kind: string; id?: string };
  if ((r.kind !== 'album' && r.kind !== 'playlist') || !r.id) return null;
  const items = pagesOf(state)[`${r.kind}:${r.id}`]?.items as CatalogTrackT[] | undefined;
  if (!items || items.length === 0) return null;
  const tracks = items.filter((t) => t && typeof t.uri === 'string');
  return tracks.length > 0 ? tracks : null;
}

export function fail(ui: Ui | null, label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ui?.setStatus(`${label} failed: ${msg} — playback unaffected`, true);
}

// Append the next page when selection reaches the end of a loaded list.
export const loadingMore = new Set<string>();
export const artistGroups = new Map<string, ArtistReleaseGroupT>();
