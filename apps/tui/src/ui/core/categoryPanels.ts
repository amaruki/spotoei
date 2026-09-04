import type { SelectRenderable } from '@opentui/core';
import type { BoxRenderable } from '@opentui/core';
import { COLOR_BORDER, COLOR_BORDER_FOCUS } from '../theme';
import type { BuiltUi } from '../componentTree';
import type { UiCoreContext } from './types';

// Shared 2x2 category-panel helpers for Home (tracks/artists/recent/
// discover) and Search (tracks/artists/albums/playlists). Exactly one
// panel per view holds keyboard focus; Tab cycles panels, arrows move within.
export const HOME_PANELS = ['tracks', 'artists', 'recent', 'discover'] as const;
export const SEARCH_PANELS = ['tracks', 'artists', 'albums', 'playlists'] as const;

export function homePanelLists(built: BuiltUi): SelectRenderable[] {
  return [built.homeTracksList, built.homeArtistsList, built.homeRecentList, built.homeDiscoverList];
}

export function homePanelBoxes(built: BuiltUi): BoxRenderable[] {
  return [built.homeTracks, built.homeArtists, built.homeRecent, built.homeDiscover];
}

export function searchPanelLists(built: BuiltUi): SelectRenderable[] {
  return [
    built.searchTracksList,
    built.searchArtistsList,
    built.searchAlbumsList,
    built.searchPlaylistsList,
  ];
}

export function searchPanelBoxes(built: BuiltUi): BoxRenderable[] {
  return [built.searchTracks, built.searchArtists, built.searchAlbums, built.searchPlaylists];
}

function highlight(lists: SelectRenderable[], boxes: BoxRenderable[], active: number): void {
  lists.forEach((list, i) => {
    if (i === active) list.focus();
    else list.blur();
  });
  boxes.forEach((box, i) => {
    box.borderColor = i === active ? COLOR_BORDER_FOCUS : COLOR_BORDER;
  });
}

export function focusedHomeList(ctx: UiCoreContext): SelectRenderable {
  const lists = homePanelLists(ctx.built);
  return lists[ctx.homePanel.value] ?? (lists[0] as SelectRenderable);
}

export function focusedSearchList(ctx: UiCoreContext): SelectRenderable {
  const lists = searchPanelLists(ctx.built);
  return lists[ctx.searchPanel.value] ?? (lists[0] as SelectRenderable);
}

export function cycleHomePanel(ctx: UiCoreContext): void {
  ctx.homePanel.value = (ctx.homePanel.value + 1) % HOME_PANELS.length;
  highlight(homePanelLists(ctx.built), homePanelBoxes(ctx.built), ctx.homePanel.value);
}

export function cycleSearchPanel(ctx: UiCoreContext): void {
  ctx.searchPanel.value = (ctx.searchPanel.value + 1) % SEARCH_PANELS.length;
  highlight(searchPanelLists(ctx.built), searchPanelBoxes(ctx.built), ctx.searchPanel.value);
}

export function focusHomePanel(ctx: UiCoreContext, index: number): void {
  ctx.homePanel.value = Math.max(0, Math.min(HOME_PANELS.length - 1, index));
  highlight(homePanelLists(ctx.built), homePanelBoxes(ctx.built), ctx.homePanel.value);
}

export function focusSearchPanel(ctx: UiCoreContext, index: number): void {
  ctx.searchPanel.value = Math.max(0, Math.min(SEARCH_PANELS.length - 1, index));
  highlight(searchPanelLists(ctx.built), searchPanelBoxes(ctx.built), ctx.searchPanel.value);
}

export function blurAllPanels(built: BuiltUi): void {
  for (const list of [...homePanelLists(built), ...searchPanelLists(built)]) {
    list.blur();
  }
  for (const box of [...homePanelBoxes(built), ...searchPanelBoxes(built)]) {
    box.borderColor = COLOR_BORDER;
  }
}
