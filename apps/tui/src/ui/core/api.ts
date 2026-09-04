import { fg, t } from '@opentui/core';
import type {
  AuthStatusDataT,
  PlaybackPositionDataT,
  QueueSnapshotT,
  SearchResponseT,
} from 'spotoei-protocol';

import { formatArtists } from '../formatters';
import { COLOR_DIM } from '../theme';
import { resolveContextTarget } from './contextMenu';
import { browseCategoryOptions, browseEntryOptions } from '../views/browseView';
import { homeRowOptions } from '../views/homeRows';
import { createEntitySetters } from './entitySetters';
import { libraryItemOptions } from '../views/library';
import { renderLyricsContent } from '../views/lyrics';
import { searchHitOptions, type SearchFilter } from '../views/search';
import { routeFromLegacy, routeKind } from './navigationStack';
import type { ContextTarget } from '../types';
import type {
  FocusArea,
  LibraryItemT,
  LyricsDocumentT,
  PlaybackChangedDataT,
  Route,
  Ui,
  UiCoreContext,
  VisualizerFrame,
} from './types';
// Creates the public `Ui` API handle that consumers use to update state.
// All setters propagate through `ctx.helpers` and trigger granular repaints.
function renderSearchResults(ctx: UiCoreContext): void {
  const results = ctx.lastSearch.value;
  if (!results) return;
  const { options, indexMap } = searchHitOptions(results, ctx.searchFilter.current);
  ctx.currentSearchIndexMap.value = indexMap;
  ctx.built.searchResults.options = options;
  ctx.built.searchResults.setSelectedIndex(0);
}

function restoreListPosition(
  ctx: UiCoreContext,
  list: { options: unknown[]; setSelectedIndex: (idx: number) => void },
): void {
  // Async loads arrive after showRoute, so re-apply the saved position here.
  const pos = ctx.positions.restore(ctx.route.current);
  const max = Math.max(0, list.options.length - 1);
  list.setSelectedIndex(Math.min(Math.max(0, pos.selected), max));
}

export function createUiApi(ctx: UiCoreContext): Ui {
  const {
    built,
    focus,
    latestVizFrame,
    manualLyricsScroll,
    palette,
    renderer,
    route,
    state,
    statusTimer,
  } = ctx;
  const { helpers } = ctx;

  return {
    navigateBack(): boolean {
      return helpers.navigateBack();
    },
    toggleSidebar(): void {
      helpers.toggleSidebar();
    },
    getRouteStack(): Route[] {
      return [...ctx.routeStack];
    },
    setRoute(next: Route | string): void {
      const target = routeFromLegacy(next);
      helpers.showRoute(target);
      helpers.setNavSelected(target);
      helpers.setFocusArea('main');
    },
    getRoute(): Route {
      return route.current;
    },
    setFocus(next: FocusArea): void {
      helpers.setFocusArea(next);
    },
    getFocus(): FocusArea {
      return focus.current;
    },
    setStatus: helpers.setStatus,
    setVisualizerFrame(frame: VisualizerFrame | null): void {
      latestVizFrame.value = frame;
      helpers.paintViz();
    },
    setSearchResults(query: string, results: SearchResponseT): void {
      state.search = { query, hitCount: results.hits.length };
      ctx.currentSearchHits.value = results.hits;
      ctx.lastSearch.value = results;
      renderSearchResults(ctx);
    },
    setSearchFilter(filter: SearchFilter): void {
      ctx.searchFilter.current = filter;
      if (ctx.lastSearch.value) renderSearchResults(ctx);
    },
    setLibraryItems(items: LibraryItemT[], error?: { code: string; message: string }): void {
      ctx.currentLibraryItems.value = items;
      built.libraryList.options = libraryItemOptions(items, error);
      restoreListPosition(ctx, built.libraryList);
    },
    setLibraryLoading(loading: boolean): void {
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('loading library…')}`;
        built.libraryList.options = [
          { name: 'Loading Library…', description: 'Fetching your saved tracks from Spotify' },
        ];
        built.libraryList.setSelectedIndex(0);
      }
    },
    setLibraryLines(lines: string[], empty: boolean): void {
      if (empty || lines.length === 0) {
        built.libraryList.options = [{ name: '(empty)', description: 'Press r to refresh' }];
      } else {
        built.libraryList.options = lines.map((line) => ({
          name: line,
          description: '',
        }));
      }
    },
    setHomeItems(rows, meta?: { error?: string }): void {
      ctx.currentHomeItems.value = rows;
      const options = homeRowOptions(rows as never);
      if (meta?.error) {
        options.push({
          name: `⚠ ${meta.error}`,
          description: 'Tab-local error — other tabs unaffected',
        });
      }
      built.homeList.options = options;
      restoreListPosition(ctx, built.homeList);
    },
    setQueueSnapshot(snap: QueueSnapshotT): void {
      const items: { name: string; description: string }[] = [];
      if (snap.current) {
        items.push({
          name: `▶ ${snap.current.name}`,
          description: formatArtists(snap.current.artists),
        });
      }
      for (const item of snap.upcoming) {
        const track = item.track;
        items.push({
          name: track.name,
          description: `${formatArtists(track.artists)} (upcoming)`,
        });
      }
      if (items.length === 0) {
        built.queueList.options = [{ name: '(queue empty)', description: 'Add tracks via search' }];
      } else {
        built.queueList.options = items;
      }
      if (built.queueList.selectedIndex >= built.queueList.options.length) {
        built.queueList.setSelectedIndex(0);
      }
    },
    ...createEntitySetters(ctx),
    setBrowseCategories(cats): void {
      ctx.currentRouteItems.value = cats as unknown[];
      built.browseList.options = browseCategoryOptions(cats as never);
      built.browseList.setSelectedIndex(0);
    },
    setBrowseEntries(entries): void {
      ctx.currentRouteItems.value = entries as unknown[];
      built.browseList.options = browseEntryOptions(entries as never);
      built.browseList.setSelectedIndex(0);
    },
    openContextMenu(title, items): void {
      helpers.openContextMenu(title, items);
    },
    closeContextMenu(): void {
      helpers.closeContextMenu();
    },
    isContextMenuOpen(): boolean {
      return helpers.isContextMenuOpen();
    },
    getContextTarget(): ContextTarget | null {
      return resolveContextTarget(ctx);
    },
    setLyrics(doc: LyricsDocumentT | null): void {
      state.lyrics = doc ?? undefined;
      built.lyricsText.content = renderLyricsContent(state);
    },
    setSearchLoading(loading: boolean): void {
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('searching Spotify…')}`;
        built.searchResults.options = [
          { name: 'Searching Spotify…', description: 'Please wait while querying Spotify Web API' },
        ];
        built.searchResults.setSelectedIndex(0);
      }
    },
    setPaletteCommands(
      cmds: Array<{ name: string; description: string; action: () => void }>,
    ): void {
      palette.commands = cmds;
      palette.filtered = [...cmds];
    },
    openPalette(): void {
      helpers.setPaletteOpen(true);
    },
    closePalette(): void {
      helpers.setPaletteOpen(false);
    },
    isPaletteOpen(): boolean {
      return palette.open;
    },
    setPlayback(playback: PlaybackChangedDataT | null): void {
      state.playback = playback;
      helpers.setHeader();
      helpers.refreshHome();
    },
    setPlaybackPosition(pos: PlaybackPositionDataT): void {
      if (state.playback) {
        state.playback.positionMs = pos.positionMs;
        helpers.setHeader();
        helpers.refreshHome();
        if (
          routeKind(route.current) === 'lyrics' &&
          !manualLyricsScroll.value &&
          state.lyrics?.kind === 'synced'
        ) {
          built.lyricsText.content = renderLyricsContent(state);
          let activeIdx = -1;
          for (let i = 0; i < state.lyrics.lines.length; i++) {
            const line = state.lyrics.lines[i];
            if (line && line.startMs <= pos.positionMs) {
              activeIdx = i;
            } else {
              break;
            }
          }
          if (activeIdx >= 0) {
            built.lyricsScroll.scrollTo(Math.max(0, activeIdx - 3));
          }
        }
      }
    },
    setAuth(auth: AuthStatusDataT): void {
      const wasAuth = state.auth.state === 'authenticated';
      state.auth = auth;
      helpers.setHeader();
      helpers.refreshSettings();
      helpers.refreshNav();
      if (!wasAuth && auth.state === 'authenticated') {
        helpers.setStatus(
          `🎉 Authenticated as ${auth.accountId ?? 'user'}! Welcome to Spotoei.`,
          true,
        );
        helpers.showRoute('home', true, true);
      }
      if (wasAuth && auth.state !== 'authenticated') {
        helpers.showRoute('settings', true, true);
      }
    },
    focusClientIdInput(): void {
      helpers.showRoute('settings');
      helpers.setFocusArea('main');
      built.clientIdInput.focus();
    },
    async start(): Promise<void> {
      // Renderer is already started.
    },
    async shutdown(): Promise<void> {
      if (statusTimer.value) clearTimeout(statusTimer.value);
      await renderer.destroy();
    },
  };
}
