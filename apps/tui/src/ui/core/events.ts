import { InputRenderableEvents, SelectRenderableEvents } from '@opentui/core';

import type { BuiltUi } from '../componentTree';
import type { Route, UiOptions } from '../types';
import { isLibraryFooterIndex } from '../views/library';
import type { AnySelect, UiCoreContext } from './types';

// Renderable event wiring extracted from the UI core for the 300 LoC cap.
// Kept in one place so `index.ts` stays a thin construction/mount module.
export function wireRenderableListeners(ctx: UiCoreContext, opts: UiOptions, built: BuiltUi): void {
  ctx.built.nav.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, option) => {
    const target = option?.value as Route | undefined;
    if (target) {
      ctx.helpers.showRoute(target);
      ctx.helpers.setFocusArea('main');
    }
  });

  built.searchInput.on(InputRenderableEvents.ENTER, () => {
    const q = built.searchInput.value.trim();
    if (q.length > 0) {
      opts.onSearchSubmit(q);
    }
  });
  const selectSearchHit = (panel: keyof UiCoreContext['searchPanelMaps']['value']): void => {
    const lists: Record<string, { getSelectedIndex: () => number }> = {
      tracks: built.searchTracksList,
      artists: built.searchArtistsList,
      albums: built.searchAlbumsList,
      playlists: built.searchPlaylistsList,
    };
    const hitIdx = ctx.searchPanelMaps.value[panel][lists[panel]?.getSelectedIndex() ?? 0];
    if (hitIdx === undefined) return;
    const hit = ctx.currentSearchHits.value[hitIdx];
    if (hit && opts.onSelectSearchHit) {
      opts.onSelectSearchHit(hit);
    }
  };
  built.searchTracksList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectSearchHit('tracks'));
  built.searchArtistsList.on(SelectRenderableEvents.ITEM_SELECTED, () =>
    selectSearchHit('artists'),
  );
  built.searchAlbumsList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectSearchHit('albums'));
  built.searchPlaylistsList.on(SelectRenderableEvents.ITEM_SELECTED, () =>
    selectSearchHit('playlists'),
  );
  built.libraryList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    const len = ctx.currentLibraryItems.value.length;
    const hasMore = ctx.libraryHasMore.value;
    if (isLibraryFooterIndex(idx, len, hasMore)) {
      if (hasMore && opts.onLibraryListEnd) opts.onLibraryListEnd();
      return;
    }
    const item = ctx.currentLibraryItems.value[idx];
    if (item && opts.onSelectLibraryItem) {
      opts.onSelectLibraryItem(item);
    }
    opts.onSelectLibrary(idx);
  });
  built.queueList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    opts.onSelectQueue(idx);
  });
  const selectHomeRow = (panel: number): void => {
    const lists = [
      built.homeTracksList,
      built.homeArtistsList,
      built.homeRecentList,
      built.homeDiscoverList,
    ];
    const keys = ['tracks', 'artists', 'recent', 'discover'] as const;
    const key = keys[panel];
    if (!key) return;
    const idx = lists[panel]?.getSelectedIndex() ?? 0;
    const row = ctx.currentHomePanelRows.value[key]?.[idx];
    if (!row || row.kind === 'header' || row.kind === 'context') return;
    if (row && opts.onSelectHomeRow) {
      opts.onSelectHomeRow(row);
    }
  };
  built.homeTracksList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectHomeRow(0));
  built.homeArtistsList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectHomeRow(1));
  built.homeRecentList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectHomeRow(2));
  built.homeDiscoverList.on(SelectRenderableEvents.ITEM_SELECTED, () => selectHomeRow(3));
  built.browseList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    if (opts.onSelectBrowseEntry) {
      opts.onSelectBrowseEntry(idx);
    }
  });
  built.artistList.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    const item = ctx.currentRouteItems.value[built.artistList.getSelectedIndex()] as unknown as
      | { id?: string }
      | undefined;
    if (item?.id && opts.onSelectArtistAlbum) {
      opts.onSelectArtistAlbum(item.id);
    }
  });
  const playSelectedEntityTrack = (idx: number): void => {
    const item = ctx.currentRouteItems.value[idx] as unknown as
      | { uri?: string; name?: string }
      | undefined;
    if (item?.uri && opts.onSelectEntityTrack) {
      opts.onSelectEntityTrack(item.uri, item.name ?? item.uri);
    }
  };
  built.albumList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    playSelectedEntityTrack(idx);
  });
  built.playlistList.on(SelectRenderableEvents.ITEM_SELECTED, (idx) => {
    playSelectedEntityTrack(idx);
  });
  // Paging trigger: reaching the last row loads the next page in place.
  const watchListEnd = (kind: 'artist' | 'album' | 'playlist', list: AnySelect): void => {
    list.on(SelectRenderableEvents.SELECTION_CHANGED, (idx: number) => {
      if (idx >= list.options.length - 1 && opts.onEntityListEnd) {
        opts.onEntityListEnd(kind);
      }
    });
  };
  watchListEnd('artist', built.artistList);
  watchListEnd('album', built.albumList);
  watchListEnd('playlist', built.playlistList);
  let libraryEndTimer: ReturnType<typeof setTimeout> | null = null;
  built.libraryList.on(SelectRenderableEvents.SELECTION_CHANGED, (idx: number) => {
    const hasMore = ctx.libraryHasMore.value;
    if (!hasMore) return;
    const isFooter = isLibraryFooterIndex(idx, ctx.currentLibraryItems.value.length, hasMore);
    const totalOptions = built.libraryList.options.length;
    if ((isFooter || idx >= Math.max(0, totalOptions - 5)) && opts.onLibraryListEnd) {
      clearTimeout(libraryEndTimer as unknown as NodeJS.Timeout);
      libraryEndTimer = setTimeout(() => {
        libraryEndTimer = null;
        opts.onLibraryListEnd?.();
      }, 150);
    }
  });
  built.paletteInput.on(InputRenderableEvents.CHANGE, (value: string) => {
    ctx.helpers.updatePaletteList(value);
  });
  built.clientIdInput.on(InputRenderableEvents.ENTER, () => {
    const val = built.clientIdInput.value.trim();
    if (val.length > 0) {
      if (opts.onSaveClientId) {
        void opts.onSaveClientId(val);
      }
      built.clientIdInput.value = '';
      built.clientIdInput.blur();
      ctx.helpers.refreshOnboarding();
    }
  });
  ctx.renderer.on('resize', (w: number) => {
    ctx.termWidth.value = w;
    // Keep overlays capped to terminal width to avoid clipping, centered.
    const pw = Math.min(60, Math.max(20, w - 2));
    const pl = Math.max(0, Math.floor((w - pw) / 2));
    const mw = Math.min(44, Math.max(20, w - 2));
    const ml = Math.max(0, Math.floor((w - mw) / 2));
    const pal = built.palette as unknown as { width?: number; left?: number };
    if (typeof pal.width !== 'undefined') pal.width = pw;
    if (typeof pal.left !== 'undefined') pal.left = pl;
    const men = built.menu as unknown as { width?: number; left?: number };
    if (typeof men.width !== 'undefined') men.width = mw;
    if (typeof men.left !== 'undefined') men.left = ml;
    const prevFocus = ctx.focus.current;
    ctx.helpers.showRoute(ctx.route.current, true, true);
    if (!ctx.built.sidebar.visible && prevFocus === 'sidebar') {
      ctx.focus.current = 'main';
      ctx.helpers.updateFocusVisuals();
    }
    ctx.helpers.paintViz();
  });
}
