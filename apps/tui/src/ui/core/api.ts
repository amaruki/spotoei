// @ts-nocheck
import { fg, t } from '@opentui/core';
import type { AuthStatusDataT, PlaybackPositionDataT, QueueSnapshotT } from 'spotoei-protocol';

import { formatArtists } from '../formatters';
import { COLOR_DIM } from '../theme';
import { resolveContextTarget } from './contextMenu';
import { browseCategoryOptions, browseEntryOptions } from '../views/browseView';
import { createEntitySetters } from './entitySetters';
import { libraryItemOptions } from '../views/library';
import { renderLyricsStyled } from '../views/lyrics';
import { createPanelSetters, restoreListPosition } from './panelSetters';
import { routeFromLegacy, routeKind } from './navigationStack';
import type { ContextTarget, UiAudioConfig } from '../types';
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
import { optimisticPlayback } from '../../playback/validator';
// Creates the public `Ui` API handle that consumers use to update state.
// All setters propagate through `ctx.helpers` and trigger granular repaints.

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
    // One-shot browse notice (offline fallback). Fire-and-forget on purpose:
    // folding it into every later status polluted unrelated messages, so a
    // cleared or superseded banner simply stops appearing.
    setBrowseBanner(banner: string | null): void {
      if (banner) helpers.setStatus(banner, true);
    },
    setVisualizerFrame(frame: VisualizerFrame | null): void {
      latestVizFrame.value = frame;
      helpers.paintViz();
    },
    setLibraryItems(
      items: LibraryItemT[],
      error?: { code: string; message: string },
      opts?: {
        append?: boolean;
        hasMore?: boolean;
        isStale?: boolean;
        savedIds?: Set<string>;
        playingUri?: string | null;
      },
    ): void {
      const playingUri = opts?.playingUri ?? state.playback?.track?.uri ?? null;
      const savedIds =
        opts?.savedIds ??
        (() => {
          const s = new Set<string>();
          for (const it of items as Array<{ uri?: string; id?: string }>) {
            if (it.uri) s.add(it.uri);
            if (it.id) s.add(it.id);
          }
          for (const it of ctx.currentLibraryItems.value as Array<{ uri?: string; id?: string }>) {
            if (it.uri) s.add(it.uri);
            if (it.id) s.add(it.id);
          }
          return s;
        })();
      const isStale = opts?.isStale;
      const hasMore = opts?.hasMore;
      if (hasMore !== undefined) ctx.libraryHasMore.value = hasMore;
      if (opts?.append) {
        const prevIdx = built.libraryList.getSelectedIndex();
        const existingKeys = new Set<string>();
        for (const it of ctx.currentLibraryItems.value as Array<{ id?: string; uri?: string }>) {
          const key = it.id ?? it.uri;
          if (key) existingKeys.add(key);
        }
        const appended = items.filter((it) => {
          const key = (it as { id?: string; uri?: string }).id ?? (it as { uri?: string }).uri;
          return !key || !existingKeys.has(key);
        });
        ctx.currentLibraryItems.value = [...ctx.currentLibraryItems.value, ...appended] as never;
        built.libraryList.options = libraryItemOptions(ctx.currentLibraryItems.value, error, {
          savedIds,
          playingUri,
          isStale,
          hasMore,
        });
        const max = Math.max(0, built.libraryList.options.length - 1);
        built.libraryList.setSelectedIndex(Math.min(Math.max(0, prevIdx), max));
        return;
      }
      const prevIdx = built.libraryList.getSelectedIndex();
      const prevId = (ctx.currentLibraryItems.value[prevIdx] as { id?: string } | undefined)?.id;
      ctx.currentLibraryItems.value = items as never;
      built.libraryList.options = libraryItemOptions(items, error, {
        savedIds,
        playingUri,
        isStale,
        hasMore,
      });
      if (prevId) {
        const newIdx = items.findIndex((it) => it.id === prevId);
        if (newIdx >= 0) {
          built.libraryList.setSelectedIndex(newIdx);
          ctx.positions.save(ctx.route.current, { selected: newIdx, scroll: 0 });
          return;
        }
      }
      restoreListPosition(ctx, built.libraryList);
    },
    setLibraryLoading(loading: boolean): void {
      if (loading) {
        // Stale-refreshing: keep cached rows visible, announce refresh in status.
        const hasRows = built.libraryList.options.some(
          (o) => !o.name.startsWith('Loading') && !o.name.startsWith('(library empty)'),
        );
        if (hasRows) {
          built.statusText.content = t`${fg(COLOR_DIM)('refreshing library…')}`;
          return;
        }
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
    ...createPanelSetters(ctx),
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
    setBrowseTracks(
      tracks: Array<{
        id: string;
        uri: string;
        name: string;
        artists: Array<{ name: string }>;
        durationMs?: number;
      }>,
    ): void {
      ctx.currentRouteItems.value = tracks as unknown[];
      built.browseList.options = tracks.map((track) => ({
        name: track.name,
        description: formatArtists(track.artists),
      }));
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
      const availWidth = Math.max(20, (ctx.termWidth.value ?? 80) - (built.sidebar.visible ? 32 : 8));
      const availHeight = ctx.renderer.height ?? 24;
      built.lyricsText.content = renderLyricsStyled(state, { width: availWidth, height: availHeight });
      const isSynced = doc?.kind === 'synced';
      built.lyricsResumeHint.visible = manualLyricsScroll.value && isSynced;
      if (!isSynced) {
        manualLyricsScroll.value = false;
        if (ctx.lyricsResumeTimer?.value)
          clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout);
        if (ctx.lyricsResumeTimer) ctx.lyricsResumeTimer.value = null;
      }
    },
    setSearchLoading(loading: boolean): void {
      // A new query wipes stale hits; background refreshes never call this,
      // so prior results stay visible until setSearchResults arrives.
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('searching Spotify…')}`;
        const row = {
          name: 'Searching Spotify…',
          description: 'Please wait while querying Spotify Web API',
        };
        for (const list of [
          built.searchTracksList,
          built.searchArtistsList,
          built.searchAlbumsList,
          built.searchPlaylistsList,
        ]) {
          list.options = [row];
          list.setSelectedIndex(0);
        }
      }
    },
    setPaletteCommands(
      cmds: Array<{
        name: string;
        description: string;
        action: () => void;
        isAvailable?: () => boolean;
      }>,
    ): void {
      palette.commands = cmds as typeof palette.commands;
      palette.filtered = [...cmds] as typeof palette.filtered;
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
      optimisticPlayback.updatePosition(pos);
      if (!state.playback) return;
      if (
        state.playback.state !== 'playing' &&
        state.playback.state !== 'loading' &&
        pos.revision !== state.playback.revision
      )
        return;
      state.playback.positionMs = pos.positionMs;
      // Store wall-clock observedAt for interpolation; playbackBar computes
      // displayPos as positionMs + elapsed since observedAt when playing.
      state.playback.observedAtMonotonicMs = Date.now();
      helpers.setHeader();
      helpers.refreshHome();
      if (
        routeKind(route.current) === 'lyrics' &&
        !manualLyricsScroll.value &&
        state.lyrics?.kind === 'synced'
      ) {
        const availWidth = Math.max(20, (ctx.termWidth.value ?? 80) - (built.sidebar.visible ? 32 : 8));
        const availHeight = ctx.renderer.height ?? 24;
        built.lyricsText.content = renderLyricsStyled(state, { width: availWidth, height: availHeight });
        built.lyricsScroll.scrollTo(0);
      }
    },
    setAuth(auth: AuthStatusDataT): void {
      const wasAuth = state.auth.state === 'authenticated';
      state.auth = auth;
      helpers.setHeader();
      helpers.refreshSettings();
      helpers.refreshOnboarding();
      helpers.refreshNav();
      if (!wasAuth && auth.state === 'authenticated') {
        helpers.setStatus(
          `🎉 Authenticated as ${auth.accountId ?? 'user'}! Welcome to Spotoei.`,
          true,
        );
        helpers.showRoute('home', true, true);
      }
      if (wasAuth && auth.state !== 'authenticated') {
        helpers.showRoute('onboarding', true, true);
      }
    },
    setStreamingPending(pending: boolean): void {
      state.streamingPending = pending;
      helpers.refreshOnboarding();
    },
    focusClientIdInput(): void {
      helpers.showRoute('onboarding', true, true);
      helpers.setFocusArea('main');
      built.clientIdInput.focus();
    },
    isAnyInputFocused(): boolean {
      return Boolean(
        built.searchInput.focused || built.clientIdInput.focused || built.paletteInput.focused,
      );
    },
    setAudioConfig(cfg: Partial<UiAudioConfig>): void {
      state.audioConfig = { ...state.audioConfig, ...cfg };
      helpers.refreshSettings();
    },
    setPrivateSession(active: boolean): void {
      state.isPrivateSession = active;
      helpers.refreshNav();
      helpers.renderPlaybackBar();
    },
    async start(): Promise<void> {
      // Renderer is already started.
    },
    async shutdown(): Promise<void> {
      helpers.stopPlaybackTickTimer?.();
      clearTimeout(statusTimer.value as NodeJS.Timeout);
      clearTimeout(ctx.lyricsResumeTimer?.value as NodeJS.Timeout);
      await renderer.destroy();
    },
  };
}
