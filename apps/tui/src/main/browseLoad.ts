import type {
  BrowseEntryT,
  BrowsePathT,
  CatalogTrackT,
  SearchResponseT,
} from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { browseResultsLabel, shouldFetchBrowseEntry } from '../browse/results';
import { getBrowseConfig } from '../config';
import type { Ui } from '../ui/types';

let browseMode: 'entries' | 'tracks' = 'entries';
let browseTracks: CatalogTrackT[] = [];
let browseTracksKey = '';

export function isBrowseTracksMode(): boolean {
  return browseMode === 'tracks';
}

export function getBrowseTrack(index: number): CatalogTrackT | undefined {
  return browseTracks[index];
}

// Single source for inline-rendered browse sources (tracks in-place).
export function isInlineBrowseEntry(entry: BrowseEntryT): boolean {
  return (
    entry.source.kind === 'new_releases' ||
    entry.source.kind === 'recommendations' ||
    entry.source.kind === 'search'
  );
}

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

// Pure selection resolution for the browse list. Categories navigate
// deeper; entries navigate to the entry level (rendered inline as tracks
// by ensureBrowseEntry — never a search route); disabled entries explain
// themselves and never issue API requests.
export function resolveBrowseSelection(
  path: { category?: string; entry?: string },
  index: number,
): BrowseNav {
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    const cat = categories[index];
    if (!cat) return { kind: 'message', text: 'Unknown browse category' };
    return {
      kind: 'route',
      route: { kind: 'browse', path: { category: cat.id } },
    };
  }
  const cat = categories.find((c) => c.id === path.category);
  const entry = cat?.entries[index] as BrowseEntryT | undefined;
  if (!entry) return { kind: 'message', text: 'Unknown browse entry' };
  const nav = activateBrowseEntry(entry);
  if (nav.kind === 'route' && nav.route.kind === 'browse') {
    nav.route.path = { category: cat?.id, entry: entry.id };
    const trail = browseBreadcrumb({ category: cat?.id, entry: entry.id });
    nav.note = trail;
  }
  return nav;
}

export function activateBrowseEntry(entry: BrowseEntryT): BrowseNav {
  if (!shouldFetchBrowseEntry(entry)) {
    return {
      kind: 'message',
      text: `${entry.label} is unavailable — configure sources in Settings, then retry`,
      persist: true,
    };
  }
  const source = entry.source;
  if (
    source.kind === 'new_releases' ||
    source.kind === 'recommendations' ||
    source.kind === 'search'
  ) {
    // Inline kinds render tracks in-place at the entry level via
    // ensureBrowseEntry — the route stays `kind: 'browse'`, never search.
    return { kind: 'route', route: { kind: 'browse', path: {} } };
  }
  switch (source.kind) {
    case 'playlist': {
      const id = source.playlistUri.split(':').pop() ?? '';
      if (!id) {
        return {
          kind: 'message',
          text: `Invalid playlist reference for ${entry.label}`,
          persist: true,
        };
      }
      return { kind: 'route', route: { kind: 'playlist', id } };
    }
    case 'library':
      return { kind: 'route', route: { kind: 'library', section: 'playlists' } };
    case 'top_artists':
      return { kind: 'route', route: { kind: 'home', tab: 'for_you' } };
    case 'action':
      return { kind: 'route', route: { kind: 'queue' } };
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

// Render the category or entry-list level into the shared browse list.
export function ensureBrowseLevel(ui: Ui, path: { category?: string; entry?: string }): void {
  browseMode = 'entries';
  browseTracks = [];
  browseTracksKey = '';
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    ui.setBrowseCategories(categories);
    return;
  }
  const cat = categories.find((c) => c.id === path.category);
  if (!cat) {
    ui.setStatus(`Unknown browse category: ${path.category}`, true);
    return;
  }
  ui.setBrowseEntries(cat.entries);
}

// Render an entry level inline as tracks. The route stays
// `kind: 'browse'` with `path.entry` set — results never touch the
// search view. Returns false when the entry is unknown or has no
// inline source (caller falls back to entries list).
export async function ensureBrowseEntry(
  ui: Ui,
  path: { category?: string; entry?: string },
  clients: { entityManager: BrowseEntityClient; searchClient: BrowseSearchClient },
): Promise<boolean> {
  if (!path.category || !path.entry) return false;
  const key = `${path.category}:${path.entry}`;
  if (browseMode === 'tracks' && browseTracksKey === key && browseTracks.length > 0) {
    ui.setBrowseTracks(browseTracks);
    return true;
  }
  const entry = findBrowseEntry(path);
  if (!entry) {
    ui.setStatus(`Unknown browse entry: ${path.entry}`, true);
    return false;
  }
  if (!shouldFetchBrowseEntry(entry)) {
    ui.setStatus(
      `${entry.label} is unavailable — configure sources in Settings, then retry`,
      true,
    );
    return false;
  }
  try {
    if (await handleBrowseEntryInline(entry, ui, clients.entityManager)) {
      browseTracksKey = key;
      return true;
    }
    if (await handleSearchBrowseEntryInline(entry, clients.searchClient, ui)) {
      browseTracksKey = key;
      return true;
    }
  } catch (err) {
    ui.setStatus(
      `Browse load failed for ${entry.label}: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
    return false;
  }
  return false;
}

export async function handleBrowseEntryInline(
  entry: BrowseEntryT,
  ui: Ui,
  entityManager: BrowseEntityClient,
): Promise<boolean> {
  if (!isInlineBrowseEntry(entry)) return false;
  if (entry.source.kind === 'new_releases') {
    const albums = (await entityManager.loadNewReleases(entry.source.limit ?? 20)) as Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ name: string }>;
    }>;
    const tracks = albums.slice(0, 20).map((a) => ({
      id: a.id,
      uri: a.uri,
      name: a.name,
      artists: a.artists,
    })) as CatalogTrackT[];
    browseTracks = tracks;
    browseMode = 'tracks';
    ui.setBrowseTracks(tracks);
    ui.setStatus(`New releases: ${albums.length} albums`, true);
    return true;
  }
  if (entry.source.kind === 'recommendations') {
    const tracks = (await entityManager.loadRecommendations({
      limit: entry.source.limit ?? 20,
      seedGenres: (entry.source as { seedGenres?: string[] }).seedGenres,
      seedArtists: (entry.source as { seedArtists?: string[] }).seedArtists,
      seedTracks: (entry.source as { seedTracks?: string[] }).seedTracks,
    })) as CatalogTrackT[];
    browseTracks = tracks;
    browseMode = 'tracks';
    ui.setBrowseTracks(tracks);
    ui.setStatus(`Recommendations: ${tracks.length} tracks`, true);
    return true;
  }
  return false;
}

// Search-backed browse entries (moods, genres, decades, activities)
// fetch via the search client but render into the browse list in place.
// The search view is never touched: no setRoute('search'), no
// setSearchResults, no search-panel state changes.
export async function handleSearchBrowseEntryInline(
  entry: BrowseEntryT,
  searchClient: BrowseSearchClient,
  ui: Ui,
): Promise<boolean> {
  if (entry.source.kind !== 'search') return false;
  const query = entry.source.query.trim();
  const res = await searchClient.search(
    query,
    (entry.source.types ?? ['track']) as Array<'track' | 'album' | 'artist' | 'playlist'>,
  );
  const tracks = res.hits
    .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
    .map((h) => h.track);
  browseTracks = tracks;
  browseMode = 'tracks';
  ui.setBrowseTracks(tracks);
  ui.setStatus(
    tracks.length > 0
      ? `${browseResultLabelFor(entry)} — ${tracks.length} tracks`
      : `No tracks found for ${entry.label}`,
    true,
  );
  return true;
}
