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
    const row = {
      name: `⚠ ${results.error.code}`,
      description: results.error.message,
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
    { key: 'playlists', list: ctx.built.searchPlaylistsList, refs: panels.playlists },
  ];
  for (const entry of entries) {
    ctx.searchPanelMaps.value[entry.key] = entry.refs.map((r) => r.index);
    entry.list.options =
      entry.refs.length > 0
        ? entry.refs.map((ref) => renderHit(results.hits[ref.index] as never))
        : [emptyRow(entry.key)];
    const saved = ctx.positions.restoreKey(
      panelPositionKey(ctx.route.current, 'search', entry.key),
    );
    const max = Math.max(0, entry.list.options.length - 1);
    entry.list.setSelectedIndex(Math.min(Math.max(0, saved.selected), max));
  }
  focusSearchPanel(ctx, ctx.searchPanel.value);
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
      meta?: { error?: string },
    ): void {
      ctx.currentHomeItems.value = rows;
      const parts = partitionHomeRows(rows as never);
      const panels = [
        { key: 'tracks', list: built.homeTracksList, rows: parts.tracks },
        { key: 'artists', list: built.homeArtistsList, rows: parts.artists },
        { key: 'recent', list: built.homeRecentList, rows: parts.recent },
      ] as const;
      for (const panel of panels) {
        const options = homeRowOptions(panel.rows as never);
        if (meta?.error && panel.key === 'tracks') {
          options.push({
            name: `⚠ ${meta.error}`,
            description: 'Tab-local error — other tabs unaffected',
          });
        }
        panel.list.options = options.length > 0 ? options : homeRowOptions([]);
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
