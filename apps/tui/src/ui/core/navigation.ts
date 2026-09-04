import { resolveClientId } from '../../config';
import { defaultRoute, popRoute, pushRoute, routeFromLegacy, routeKind } from './navigationStack';
import type { FocusArea, Route, UiCoreContext } from './types';

export function createNavigationHelpers(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, route, state } = ctx;
  const listForRoute = (r: Route) => {
    const kind = routeKind(r);
    if (kind === 'home' && (r as { browse?: unknown }).browse === undefined) return built.homeList;
    if (kind === 'search') return built.searchResults;
    if (kind === 'library') return built.libraryList;
    if (kind === 'queue') return built.queueList;
    if (kind === 'artist') return built.artistList;
    if (kind === 'album') return built.albumList;
    if (kind === 'playlist') return built.playlistList;
    if (kind === 'home' && (r as { browse?: unknown }).browse !== undefined)
      return built.browseList;
    return null;
  };
  const showRoute = (nextInput: Route | string, force = false, replace = false): void => {
    let next = routeFromLegacy(nextInput);
    const kind = routeKind(next);
    if (!force && state.auth.state !== 'authenticated' && kind !== 'settings') {
      const clientRes = resolveClientId();
      if (!clientRes.clientId) {
        ctx.helpers.setStatus('Please set your Spotify Client ID in Settings first');
      } else {
        ctx.helpers.setStatus('Please complete authentication in Settings first');
      }
      next = { kind: 'settings' };
    }
    const currentKind = routeKind(route.current);
    if (
      !replace &&
      (currentKind !== kind || JSON.stringify(route.current) !== JSON.stringify(next))
    ) {
      const curList = listForRoute(route.current);
      if (curList) {
        ctx.positions.save(route.current, { selected: curList.getSelectedIndex(), scroll: 0 });
      }
      ctx.routeStack = pushRoute(ctx.routeStack, route.current, next);
    }

    route.current = next;
    const finalKind = routeKind(next);

    const isHomeBrowse =
      finalKind === 'home' && (next as { browse?: unknown }).browse !== undefined;
    built.home.visible = finalKind === 'home' && !isHomeBrowse;
    built.search.visible = finalKind === 'search';
    built.library.visible = finalKind === 'library';
    built.queue.visible = finalKind === 'queue';
    built.lyrics.visible = finalKind === 'lyrics';
    built.settings.visible = finalKind === 'settings';
    built.artist.visible = finalKind === 'artist';
    built.album.visible = finalKind === 'album';
    built.playlist.visible = finalKind === 'playlist';
    built.browse.visible = isHomeBrowse;
    built.visualizerFull.visible = finalKind === 'visualizer';
    const isVizFull = finalKind === 'visualizer';
    // Login-only mode: unauthenticated users see the settings login page
    // with no sidebar, side panel, or playback bar — like a logged-out web route.
    const loginMode = state.auth.state !== 'authenticated';
    // Responsive tiers: >=100 sidebar visible, 80–99 collapsible via
    // Toggle Sidebar (default visible), <80 drawer (hidden, palette nav).
    const w = ctx.termWidth.value;
    const sidebarByWidth = w >= 100 ? true : w >= 80 ? ctx.sidebarPinned.value : false;
    built.sidebar.visible = !loginMode && !isVizFull && sidebarByWidth;
    built.playbackBar.visible = !loginMode;

    if (finalKind === 'lyrics') {
      manualLyricsScroll.value = false;
    }
    ctx.helpers.setNavSelected(next);

    if (focus.current === 'main') {
      if (finalKind === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else {
        built.searchInput.blur();
        built.searchResults.blur();
      }
      if (finalKind === 'settings') {
        ctx.helpers.refreshSettings();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
      } else {
        built.clientIdInput.blur();
      }
      if (finalKind === 'library') {
        built.libraryList.focus();
      } else {
        built.libraryList.blur();
      }
      if (finalKind === 'queue') {
        built.queueList.focus();
      } else {
        built.queueList.blur();
      }
      if (finalKind === 'home' && !isHomeBrowse) {
        built.homeList.focus();
      } else {
        built.homeList.blur();
      }
      for (const [viewKind, list] of [
        ['artist', built.artistList],
        ['album', built.albumList],
        ['playlist', built.playlistList],
        ['browse', built.browseList],
      ] as const) {
        if (finalKind === viewKind || (viewKind === 'browse' && finalKind === 'home')) {
          if (viewKind === 'browse' && finalKind === 'home') {
            if ((next as { browse?: unknown }).browse !== undefined) list.focus();
            else list.blur();
          } else if (finalKind === viewKind) {
            list.focus();
          }
        } else {
          list.blur();
        }
      }
    } else {
      built.homeList.blur();
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
      built.artistList.blur();
      built.albumList.blur();
      built.playlistList.blur();
      built.browseList.blur();
    }
    const nextList = listForRoute(next);
    if (nextList) {
      const pos = ctx.positions.restore(next);
      const max = Math.max(0, nextList.options.length - 1);
      nextList.setSelectedIndex(Math.min(Math.max(0, pos.selected), max));
    }
    if (opts.onRouteChange) {
      opts.onRouteChange(next);
    }
  };

  const navigateBack = (): boolean => {
    if (state.auth.state !== 'authenticated') {
      ctx.helpers.setStatus('Complete setup to continue — A: authenticate, C: edit Client ID');
      return false;
    }
    const { stack, popped } = popRoute(ctx.routeStack);
    ctx.routeStack = stack;
    if (popped) {
      showRoute(popped, true, true);
      return true;
    }
    // If stack was empty, navigate to Home
    if (routeKind(route.current) !== 'home') {
      showRoute(defaultRoute(), true, true);
      return true;
    }
    ctx.helpers.setStatus('Already at Home — press a number key or Tab to navigate');
    return false;
  };

  const setFocusArea = (next: FocusArea): void => {
    focus.current = next;
    ctx.helpers.updateFocusVisuals();
    const curKind = routeKind(route.current);

    if (next === 'sidebar') {
      built.homeList.blur();
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
      built.artistList.blur();
      built.albumList.blur();
      built.playlistList.blur();
      built.browseList.blur();
      built.nav.focus();
    } else {
      built.nav.blur();
      if (curKind === 'home' && (route.current as { browse?: unknown }).browse === undefined) {
        built.homeList.focus();
      } else if (curKind === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else if (curKind === 'settings') {
        ctx.helpers.refreshSettings();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
      } else if (curKind === 'library') {
        built.libraryList.focus();
      } else if (curKind === 'queue') {
        built.queueList.focus();
      } else if (curKind === 'artist') {
        built.artistList.focus();
      } else if (curKind === 'album') {
        built.albumList.focus();
      } else if (curKind === 'playlist') {
        built.playlistList.focus();
      } else if (curKind === 'visualizer') {
        built.nav.blur();
      }
      if (opts.onRouteChange) {
        opts.onRouteChange(route.current);
      }
    }
  };

  const toggleSidebar = (): void => {
    ctx.sidebarPinned.value = !ctx.sidebarPinned.value;
    showRoute(route.current, true, true);
    if (!built.sidebar.visible && focus.current === 'sidebar') {
      setFocusArea('main');
    }
  };

  return { showRoute, navigateBack, setFocusArea, toggleSidebar };
}
