import type { SearchResponseT } from 'spotoei-protocol';
import { panelPositionKey } from '../../navigation/viewPositions';
import { homeRowOptions, partitionHomeRows } from '../views/homeRows';
import { partitionSearchHits, renderHit, type SearchFilter } from '../views/search';
import { focusHomePanel, focusSearchPanel } from './categoryPanels';
import type { UiCoreContext } from './types';

export function restoreListPosition(
  ctx: UiCoreContext,
  list: { options: unknown[]; setSelectedIndex: (idx: number) => void },
): void {
  // Async loads arrive after showRoute, so re-apply the saved position here.
  const pos = ctx.positions.restore(ctx.route.current);
  const max = Math.max(0, list.options.length - 1);
  list.setSelectedIndex(Math.min(Math.max(0, pos.selected), max));
}

function emptyRow(label: string): { name: string; description: string } {
  return { name: '(no results)', description: label };
}

function renderSearchResults(ctx: UiCoreContext): void {
  const results = ctx.lastSearch.value;
  if (!results) return;
  if (results.error) {
    const isQuota = results.error.code === 'QUOTA_EXCEEDED';
    const row = {
      name: `⚠ ${results.error.code}`,
      description: isQuota
        ? 'Quota exceeded — Spotify API limit reached. Try again tomorrow.'
        : results.error.message,
    };
    for (const list of [
      ctx.built.searchTracksList,
      ctx.built.searchArtistsList,
      ctx.built.searchAlbumsList,
      ctx.built.searchPlaylistsList,
    ]) {
      list.options = [row];
      list.setSelectedIndex(0);
    }
    ctx.searchPanelMaps.value = { tracks: [], artists: [], albums: [], playlists: [] };
    return;
  }
  const panels = partitionSearchHits(results.hits, ctx.searchFilter.current);
  const entries: Array<{
    key: keyof UiCoreContext['searchPanelMaps']['value'];
    list: { options: unknown[]; setSelectedIndex: (idx: number) => void };
    refs: Array<{ index: number }>;
  }> = [
    { key: 'tracks', list: ctx.built.searchTracksList, refs: panels.tracks },
    { key: 'artists', list: ctx.built.searchArtistsList, refs: panels.artists },
    { key: 'albums', list: ctx.built.searchAlbumsList, refs: panels.albums },
  ];
  const playingUri = (ctx.state.playback as unknown as { track?: { uri?: string } })?.track?.uri ?? null;
  const savedIds = new Set<string>();
  for (const it of ctx.currentLibraryItems.value as Array<{ uri?: string; id?: string }>) {
    if (it.uri) savedIds.add(it.uri);
    if (it.id) savedIds.add(it.id);
  }
  const isStale = (results as unknown as { isStale?: boolean }).isStale ?? false;
  for (const entry of entries) {
    ctx.searchPanelMaps.value[entry.key] = entry.refs.map((r) => r.index);
    entry.list.options =
      entry.refs.length > 0
        ? entry.refs.map((ref) => renderHit(results.hits[ref.index] as never, { savedIds, playingUri, isStale }))
        : [emptyRow(entry.key)];
    const saved = ctx.positions.restoreKey(panelPositionKey(ctx.route.current, 'search', entry.key));
    const max = Math.max(0, entry.list.options.length - 1);
    entry.list.setSelectedIndex(Math.min(Math.max(0, saved.selected), max));
  }
  let targetPanel = ctx.searchPanel.value;
  if (entries[targetPanel]?.refs.length === 0) {
    const next = entries.findIndex((e) => e.refs.length > 0);
    if (next >= 0) targetPanel = next;
    else {
      targetPanel = 0;
      entries[0]?.list.setSelectedIndex(0);
    }
  }
  focusSearchPanel(ctx, targetPanel);
}
// Home + search panel setters extracted from api.ts for the 300 LoC cap.
export function createPanelSetters(ctx: UiCoreContext) {
  const { built } = ctx;
  return {
    setSearchResults(query: string, results: SearchResponseT): void {
      ctx.state.search = { query, hitCount: results.hits.length };
      ctx.currentSearchHits.value = results.hits;
      ctx.lastSearch.value = results;
      renderSearchResults(ctx);
    },
    setSearchFilter(filter: SearchFilter): void {
      ctx.searchFilter.current = filter;
      if (ctx.lastSearch.value) renderSearchResults(ctx);
    },
    setHomeItems(
      rows: Parameters<import('../types').Ui['setHomeItems']>[0],
      meta?: { error?: string; rangeLabel?: string },
    ): void {
      ctx.currentHomeItems.value = rows;
      if (meta?.rangeLabel) {
        built.homeTracks.title = `Top Tracks · ${meta.rangeLabel}`;
      }
      const panels = [
        {
          key: 'tracks',
          list: built.homeTracksList,
          empty: '(no top tracks yet)',
        },
        {
          key: 'artists',
          list: built.homeArtistsList,
          empty: '(no top artists yet)',
        },
        {
          key: 'recent',
          list: built.homeRecentList,
          empty: '(nothing played recently)',
        },
        {
          key: 'discover',
          list: built.homeDiscoverList,
          empty: '(no categories)',
        },
      ] as const;
      const parts = partitionHomeRows(rows as never);
      const byKey = {
        tracks: parts.tracks,
        artists: parts.artists,
        recent: parts.recent,
        discover: parts.discover,
      };
      for (const panel of panels) {
        const rawRows = byKey[panel.key] as import('../views/homeRows').HomeRow[];
        if (panel.key === 'discover') {
          const headerRow = rawRows.find((r) => r.kind === 'header');
          if (headerRow && headerRow.text.startsWith('Discover · ')) {
            const sub = headerRow.text.replace('Discover · ', '');
            built.homeDiscover.title = `Discover · ${sub}`;
          }
        }
        const hasContent = rawRows.some((r) => r.kind !== 'header');
        const effectiveRows = hasContent ? rawRows.filter((r) => r.kind !== 'header') : rawRows;
        const options = homeRowOptions(effectiveRows as never, panel.empty);
        if (meta?.error && panel.key === 'tracks') {
          options.push({
            name: `⚠ ${meta.error}`,
            description: 'Tab-local error — other tabs unaffected',
          });
        }
        panel.list.options = options;
        const saved = ctx.positions.restoreKey(
          panelPositionKey(ctx.route.current, 'home', panel.key),
        );
        const max = Math.max(0, panel.list.options.length - 1);
        panel.list.setSelectedIndex(Math.min(Math.max(0, saved.selected), max));
      }
      focusHomePanel(ctx, ctx.homePanel.value);
    },
  };
}
