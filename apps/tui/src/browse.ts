// Browse catalog registry and navigation sources.
// Maps static and configured browse categories into executable search or playlist sources.

import type { BrowseCategoryT, BrowseConfigT, BrowseEntryT } from 'spotoei-protocol';
import { getBrowseCategories, getCategoryPlaylists } from './webApi/browseEndpoints';
import type { Transport } from './webApi/transport';
import {
  ACTIVITIES_ENTRIES,
  CHARTS_FALLBACK_ENTRIES,
  DECADES_ENTRIES,
  DISCOVER_ENTRIES,
  EDITORIAL_FALLBACK_ENTRIES,
  GENRES_ENTRIES,
  MOODS_ENTRIES,
  NEW_RELEASES_ENTRIES,
} from './browse/data';

export const DEFAULT_BROWSE_CONFIG: BrowseConfigT = {
  charts: [],
  editorialPlaylists: [],
  drivingPlaylistUris: [],
};

export function buildBrowseCategories(
  config: BrowseConfigT = DEFAULT_BROWSE_CONFIG,
): BrowseCategoryT[] {
  const categories: BrowseCategoryT[] = [];

  // 1. Discover
  categories.push({
    id: 'discover',
    label: 'Discover',
    entries: DISCOVER_ENTRIES,
  });

  // 2. Charts (configured URIs win; search fallback otherwise)
  const chartEntries: BrowseEntryT[] = config.charts.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.countryCode ? `Top tracks in ${c.countryCode}` : 'Top trending tracks',
    enabled: true,
    source: { kind: 'playlist', playlistUri: c.playlistUri },
  }));
  categories.push({
    id: 'charts',
    label: 'Charts',
    entries: chartEntries.length > 0 ? chartEntries : CHARTS_FALLBACK_ENTRIES,
  });

  // 3. New Releases
  categories.push({
    id: 'new_releases',
    label: 'New Releases',
    entries: NEW_RELEASES_ENTRIES,
  });

  // 4. Moods
  categories.push({
    id: 'moods',
    label: 'Moods',
    entries: MOODS_ENTRIES,
  });

  // 5. Activities
  categories.push({
    id: 'activities',
    label: 'Activities',
    entries: ACTIVITIES_ENTRIES,
  });

  // 6. In the Car
  const carEntries: BrowseEntryT[] = [
    {
      id: 'resume_queue',
      label: 'Resume Queue',
      description: 'Continue listening where you left off',
      enabled: true,
      source: { kind: 'action', action: 'resume_queue' },
    },
    ...config.drivingPlaylistUris.map((uri, idx) => ({
      id: `driving_pin_${idx + 1}`,
      label: `Driving Pin ${idx + 1}`,
      description: 'Pinned driving playlist',
      enabled: true,
      source: { kind: 'playlist' as const, playlistUri: uri },
    })),
    {
      id: 'upbeat_drive',
      label: 'Upbeat Drive',
      description: 'Energetic road trip anthems',
      enabled: true,
      source: { kind: 'search', query: 'road trip upbeat drive', types: ['playlist'] },
    },
    {
      id: 'chill_drive',
      label: 'Night Drive',
      description: 'Late night cruising atmospheric beats',
      enabled: true,
      source: { kind: 'search', query: 'night drive chill', types: ['playlist'] },
    },
  ];
  categories.push({
    id: 'in_the_car',
    label: 'In the Car',
    entries: carEntries,
  });

  // 7. Genres
  categories.push({
    id: 'genres',
    label: 'Genres',
    entries: GENRES_ENTRIES,
  });

  // 8. Decades
  categories.push({
    id: 'decades',
    label: 'Decades',
    entries: DECADES_ENTRIES,
  });

  // 9. Editorial (configured URIs win; search fallback otherwise)
  const editorialEntries: BrowseEntryT[] = config.editorialPlaylists.map((p) => ({
    id: p.id,
    label: p.label,
    description: 'Curated editorial playlist',
    enabled: true,
    source: { kind: 'playlist', playlistUri: p.playlistUri },
  }));
  categories.push({
    id: 'editorial',
    label: 'Editorial',
    entries: editorialEntries.length > 0 ? editorialEntries : EDITORIAL_FALLBACK_ENTRIES,
  });
  return categories;
}

export async function fetchLiveBrowseCategories(
  transport: Transport,
  config: BrowseConfigT = DEFAULT_BROWSE_CONFIG,
  options?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<BrowseCategoryT[]> {
  try {
    const live = await getBrowseCategories(
      transport,
      options?.limit,
      options?.offset,
      options?.signal,
    );
    if (!live || live.length === 0) {
      return buildBrowseCategories(config);
    }
    return live.map((cat) => ({
      id: cat.id,
      label: cat.name,
      entries: cat.id === 'discover' ? DISCOVER_ENTRIES : [],
    }));
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return buildBrowseCategories(config);
  }
}

export async function fetchLiveCategoryEntries(
  transport: Transport,
  categoryId: string,
  options?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<BrowseEntryT[]> {
  try {
    const playlists = await getCategoryPlaylists(
      transport,
      categoryId,
      options?.limit,
      options?.offset,
      options?.signal,
    );
    if (!playlists || playlists.length === 0) {
      return DISCOVER_ENTRIES;
    }
    return playlists.map((p) => ({
      id: p.id,
      label: p.name,
      description: p.description ?? `Playlist · ${p.name}`,
      enabled: true,
      source: { kind: 'playlist', playlistUri: p.uri },
    }));
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return DISCOVER_ENTRIES;
  }
}

export const getLiveBrowseCategories = fetchLiveBrowseCategories;
export const getCategoryPlaylistsWithFallback = fetchLiveCategoryEntries;
