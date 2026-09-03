import { resolveClientId } from '../../config';
import type { FocusArea, Route, UiCoreContext } from './types';

export function createNavigationHelpers(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, route, state } = ctx;

  const showRoute = (next: Route, force = false): void => {
    if (!force && state.auth.state !== 'authenticated' && next !== 'settings') {
      const clientRes = resolveClientId();
      if (!clientRes.clientId) {
        ctx.helpers.setStatus('Setup required: Please enter Spotify Client ID first (press c to edit)', true);
      } else {
        ctx.helpers.setStatus('Authentication required: Please log in with Spotify (press a or Enter to log in)', true);
      }
      next = 'settings';
    }

    route.current = next;
    built.home.visible = next === 'home';
    built.search.visible = next === 'search';
    built.library.visible = next === 'library';
    built.queue.visible = next === 'queue';
    built.lyrics.visible = next === 'lyrics';
    built.settings.visible = next === 'settings';
    if (next === 'lyrics') {
      manualLyricsScroll.value = false;
    }
    ctx.helpers.setNavSelected(next);

    if (focus.current === 'main') {
      if (next === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else {
        built.searchInput.blur();
        built.searchResults.blur();
      }
      if (next === 'settings') {
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
      if (next === 'library') {
        built.libraryList.focus();
      } else {
        built.libraryList.blur();
      }
      if (next === 'queue') {
        built.queueList.focus();
      } else {
        built.queueList.blur();
      }
    } else {
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
    }
    if (opts.onRouteChange) {
      opts.onRouteChange(next);
    }
  };

  const setFocusArea = (next: FocusArea): void => {
    focus.current = next;
    ctx.helpers.updateFocusVisuals();

    if (next === 'sidebar') {
      built.searchInput.blur();
      built.searchResults.blur();
      built.clientIdInput.blur();
      built.libraryList.blur();
      built.queueList.blur();
      built.nav.focus();
    } else {
      built.nav.blur();
      if (route.current === 'search') {
        built.searchResults.blur();
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else if (route.current === 'settings') {
        ctx.helpers.refreshSettings();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
      } else if (route.current === 'library') {
        built.libraryList.focus();
      } else if (route.current === 'queue') {
        built.queueList.focus();
      }
      if (opts.onRouteChange) {
        opts.onRouteChange(route.current);
      }
    }
  };

  return { showRoute, setFocusArea };
}
