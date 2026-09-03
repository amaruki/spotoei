import { resolveClientId } from '../../config';
import { defaultRoute, popRoute, pushRoute, routeFromLegacy, routeKind } from './navigationStack';
import type { FocusArea, Route, UiCoreContext } from './types';

export function createNavigationHelpers(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, route, routeStack, state, visualizerVisible } =
    ctx;
  const showRoute = (nextInput: Route | string, force = false): void => {
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
    if (currentKind !== kind || JSON.stringify(route.current) !== JSON.stringify(next)) {
      ctx.routeStack = pushRoute(routeStack, route.current, next);
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
    built.sidebar.visible = !isVizFull;
    built.right.visible = !isVizFull && visualizerVisible.value;

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
    if (opts.onRouteChange) {
      opts.onRouteChange(next);
    }
  };

  const navigateBack = (): boolean => {
    const { stack, popped } = popRoute(ctx.routeStack);
    ctx.routeStack = stack;
    if (popped) {
      showRoute(popped, true);
      return true;
    }
    // If stack was empty, navigate to Home
    if (routeKind(route.current) !== 'home') {
      showRoute(defaultRoute(), true);
      return true;
    }
    return false;
  };

  const setFocusArea = (next: FocusArea): void => {
    focus.current = next;
    ctx.helpers.updateFocusVisuals();
    const curKind = routeKind(route.current);

    if (next === 'sidebar') {
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
      if (curKind === 'search') {
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

  return { showRoute, navigateBack, setFocusArea };
}
