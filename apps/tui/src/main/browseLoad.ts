// @ts-nocheck
import type { BrowseEntryT, BrowsePathT, CatalogTrackT, SearchResponseT } from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { browseResultsLabel, shouldFetchBrowseEntry } from '../browse/results';
import { getBrowseConfig } from '../config';
import type { Ui } from '../ui/types';
// @ts-ignore
import { getCategoryPlaylistsCached, getLiveCategories } from './browseLive';

let browseMode: 'entries' | 'tracks' = 'entries';
let browseTracks: CatalogTrackT[] = [];
let browseTracksKey = '';
let liveFallbackBanner = false;
// Entries currently rendered in entries-mode that do not come from the
// static registry (e.g. live Spotify category playlists). Selections
// resolve against these first so dynamic rows activate correctly.
let dynamicEntries: BrowseEntryT[] = [];
let dynamicEntriesKey = '';
// Monotonic token so out-of-order live responses never paint stale data
// when the user jumps between categories quickly.
let liveNavSeq = 0;
export function isBrowseTracksMode(): boolean {
  return browseMode === 'tracks';
}
export function getBrowseTrack(index: number): CatalogTrackT | undefined {
  return browseTracks[index];
}
export function isInlineBrowseEntry(entry: BrowseEntryT): boolean {
  const k = (entry.source as unknown as { kind: string }).kind;
  return k === 'new_releases' || k === 'recommendations' || k === 'search';
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
  loadPlaylistTracks?: (
    id: string,
    offset?: number,
    limit?: number,
  ) => Promise<{ items: Array<unknown> }>;
}
export interface BrowseLiveClient {
  getCategories: any;
  getCategoryPlaylists: any;
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

export function wasBrowseLiveFallback(): boolean {
  return liveFallbackBanner;
}

export function browseEntriesKey(path: { category?: string; entry?: string }): string {
  return `${path.category ?? ''}:${path.entry ?? ''}`;
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

export function setDynamicEntries(key: string, entries: BrowseEntryT[]): void {
  dynamicEntriesKey = key;
  dynamicEntries = entries;
}

export function clearDynamicEntries(): void {
  dynamicEntries = [];
  dynamicEntriesKey = '';
}

export function getDynamicEntry(key: string, index: number): BrowseEntryT | undefined {
  if (!key || dynamicEntriesKey !== key) return undefined;
  return dynamicEntries[index];
}

// Categories currently rendered at the browse root (live or static).
// Root-level selection resolves against these so a live list never
// misfires into the static registry at the same index.
let displayedCategories: Array<{ id: string; label: string }> = [];

export function getDisplayedCategory(index: number): { id: string; label: string } | undefined {
  return displayedCategories[index];
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
export function ensureBrowseLevel(ui: Ui, path: { category?: string; entry?: string }): void {
  browseMode = 'entries';
  browseTracks = [];
  browseTracksKey = '';
  clearDynamicEntries();
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    displayedCategories = categories.map((c) => ({ id: c.id, label: c.label }));
    ui.setBrowseCategories(categories);
    if (liveFallbackBanner)
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(
        'Browse live unavailable · using offline categories',
      );
    else
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
    return;
  }
  const cat = categories.find((c) => c.id === path.category);
  if (!cat) {
    ui.setStatus(`Unknown browse category: ${path.category}`, true);
    return;
  }
  ui.setBrowseEntries(cat.entries);
}
export async function ensureBrowseLevelLive(
  ui: Ui,
  path: { category?: string; entry?: string },
  api: unknown,
  cache?: unknown,
  accountId = 'default',
  signal?: AbortSignal,
): Promise<boolean> {
  const seq = ++liveNavSeq;
  const stale = () => seq !== liveNavSeq || signal?.aborted;
  browseMode = 'entries';
  browseTracks = [];
  browseTracksKey = '';
  clearDynamicEntries();
  if (!path.category) {
    // Transient marker while live data resolves (spotify-player renders
    // "Loading..." the same way); replaced by content or fallback banner.
    ui.setStatus('Loading browse…');
    try {
      const { categories, fallback, banner, code } = await getLiveCategories(
        api,
        cache,
        accountId,
        signal,
      );
      liveFallbackBanner = fallback;
      if (stale()) return false;
      if (!fallback && categories.length > 0) {
        const mapped = categories.map((c) => ({
          id: c.id,
          label: c.name,
          entries: [] as BrowseEntryT[],
        }));
        displayedCategories = mapped.map((c) => ({ id: c.id, label: c.label }));
        ui.setBrowseCategories(mapped);
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
        return true;
      }
      const cats = buildBrowseCategories(getBrowseConfig());
      displayedCategories = cats.map((c) => ({ id: c.id, label: c.label }));
      ui.setBrowseCategories(cats);
      if (fallback && !stale()) {
        const msg =
          code === 'QUOTA_EXCEEDED' && banner
            ? banner
            : 'Browse live unavailable · using offline categories';
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(msg);
      } else {
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
      }
      return true;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      if (err instanceof Error && err.name === 'AbortError') return false;
      const cats = buildBrowseCategories(getBrowseConfig());
      displayedCategories = cats.map((c) => ({ id: c.id, label: c.label }));
      ui.setBrowseCategories(cats);
      return true;
    }
  }
  const id = path.category;
  const key = browseEntriesKey(path);
  // Static registry ids render instantly: the live endpoint has no such
  // categories, so probing it first only burns a doomed request (the
  // 403s for discover/moods/charts/... seen in production logs).
  const staticCat = buildBrowseCategories(getBrowseConfig()).find((c) => c.id === id);
  if (staticCat) {
    if (stale()) return false;
    ui.setBrowseEntries(staticCat.entries);
    return true;
  }
  // Live Spotify category id: probe its playlists, else an honest message.
  let isStale = false;
  ui.setStatus('Loading browse…');
  try {
    // Try to detect stale via cache peek
    if (cache) {
      const cacheKey = `browse:category:${encodeURIComponent(id)}:playlists:0`;
      const peek = cache.tryGetCached<unknown[]>(accountId, cacheKey);
      if (peek?.isStale) isStale = true;
    }
    const playlists = await getCategoryPlaylistsCached(api, cache, accountId, id, signal);
    if (stale()) return false;
    if (playlists.length > 0) {
      const entries = playlists.map((p) => ({
        id: p.id,
        label: p.name,
        description: p.description ?? '',
        enabled: true,
        source: { kind: 'playlist', playlistUri: p.uri } as unknown as BrowseEntryT['source'],
      }));
      setDynamicEntries(key, entries);
      ui.setBrowseEntries(entries, { isStale } as unknown as never);
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
      return true;
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    if (err instanceof Error && err.name === 'AbortError') return false;
  }
  if (stale()) return false;
  ui.setStatus(`Unknown browse category: ${id}`, true);
  return false;
}
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
  clearDynamicEntries();
  const entry = findBrowseEntry(path);
  if (!entry) {
    ui.setStatus(`Unknown browse entry: ${path.entry}`, true);
    return false;
  }
  if (!shouldFetchBrowseEntry(entry)) {
    ui.setStatus(`${entry.label} is unavailable — configure sources in Settings, then retry`, true);
    return false;
  }
  try {
    if (await handleBrowseEntryInline(entry, ui, clients.entityManager)) {
      // Cache the key only when tracks mode was actually entered:
      // navigation/redirect handlers also return true but leave no rows.
      if (isBrowseTracksMode()) browseTracksKey = key;
      return true;
    }
    if (
      await handleSearchBrowseEntryInline(entry, clients.searchClient, ui, clients.entityManager)
    ) {
      if (isBrowseTracksMode()) browseTracksKey = key;
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
export async function ensureCategoryPlaylistEntry(
  ui: Ui,
  playlistId: string,
  clients: { entityManager: { loadPlaylist: (id: string) => Promise<unknown> } },
): Promise<boolean> {
  try {
    const view = (await clients.entityManager.loadPlaylist(playlistId)) as {
      playlist?: { name?: string };
    } | null;
    void view;
    return true;
  } catch {
    return false;
  }
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
    const tracks = albums
      .slice(0, 20)
      .map((a) => ({ id: a.id, uri: a.uri, name: a.name, artists: a.artists })) as CatalogTrackT[];
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
export async function handleSearchBrowseEntryInline(
  entry: BrowseEntryT,
  searchClient: BrowseSearchClient,
  ui: Ui,
  entityManager?: BrowseEntityClient,
): Promise<boolean> {
  if (entry.source.kind !== 'search') return false;
  const query = entry.source.query.trim();
  if (!query || query === '*') {
    browseMode = 'entries';
    browseTracks = [];
    browseTracksKey = '';
    ui.setRoute({ kind: 'search' });
    ui.setStatus('Type a keyword in Search — pick a result to play it', true);
    return true;
  }
  const res = await searchClient.search(
    query,
    (entry.source.types ?? ['track']) as Array<'track' | 'album' | 'artist' | 'playlist'>,
  );
  const tracks = res.hits
    .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
    .map((h) => h.track);
  if (tracks.length > 0) {
    browseTracks = tracks;
    browseMode = 'tracks';
    ui.setBrowseTracks(tracks);
    ui.setStatus(`${browseResultLabelFor(entry)} — ${tracks.length} tracks`, true);
    return true;
  }
  // No direct track hits: walk the entry's own type order. Playlist and
  // album matches open their full entity page (header + all tracks, like
  // spotify-player's browse → context flow) instead of rendering a flat,
  // context-free track list. Each candidate is probed with the same page
  // parameters the entity page uses, so dead playlists are skipped and the
  // entity page itself renders from cache.
  for (const kind of entry.source.types ?? []) {
    if (kind === 'playlist') {
      const candidates = rankPlaylistHits(
        res.hits.filter(
          (h): h is { type: 'playlist'; playlist: { id: string; uri: string; name: string } } =>
            h.type === 'playlist',
        ),
        query,
      ).slice(0, 3);
      for (const hit of candidates) {
        const pid = (hit.playlist.uri.split(':').pop() ?? '').trim() || hit.playlist.id;
        if (!pid) continue;
        if (entityManager?.loadPlaylistTracks) {
          try {
            const page = await entityManager.loadPlaylistTracks(pid, 0, 100);
            if ((page.items as unknown[]).length === 0) continue;
          } catch {
            continue;
          }
        }
        browseMode = 'entries';
        browseTracks = [];
        browseTracksKey = '';
        ui.setRoute({ kind: 'playlist', id: pid });
        ui.setStatus(`${browseResultLabelFor(entry)} — “${hit.playlist.name}”`, true);
        return true;
      }
    }
    if (kind === 'album') {
      const candidates = res.hits
        .filter(
          (h): h is { type: 'album'; album: { id: string; uri: string; name: string } } =>
            h.type === 'album',
        )
        .slice(0, 3);
      for (const hit of candidates) {
        const aid = (hit.album.uri.split(':').pop() ?? '').trim() || hit.album.id;
        if (!aid) continue;
        if (entityManager?.loadAlbumTracks) {
          try {
            const page = await entityManager.loadAlbumTracks(aid, 0, 20);
            if ((page.items as unknown[]).length === 0) continue;
          } catch {
            continue;
          }
        }
        browseMode = 'entries';
        browseTracks = [];
        browseTracksKey = '';
        ui.setRoute({ kind: 'album', id: aid });
        ui.setStatus(`${browseResultLabelFor(entry)} — “${hit.album.name}”`, true);
        return true;
      }
    }
  }
  browseTracks = [];
  browseMode = 'tracks';
  ui.setBrowseTracks([]);
  ui.setStatus(`No tracks found for ${entry.label}`, true);
  return true;
}
