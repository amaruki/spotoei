import { HERO_WIDE_BREAKPOINT } from '../componentTree/onboardingView';
import { resolveClientId } from '../../config';
import { panelPositionKey } from '../../navigation/viewPositions';
import {
  blurAllPanels,
  focusedHomeList,
  focusedSearchList,
  focusHomePanel,
  HOME_PANELS,
  homePanelLists,
  SEARCH_PANELS,
  searchPanelLists,
} from './categoryPanels';
import { defaultRoute, popRoute, pushRoute, routeFromLegacy, routeKind } from './navigationStack';
import type { AnySelect, FocusArea, Route, UiCoreContext } from './types';
import { renderLyricsStyled } from '../views/lyrics';

export function createNavigationHelpers(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, route, state } = ctx;
  const saveRoutePosition = (r: Route): void => {
    const kind = routeKind(r);
    if (kind === 'home') {
      homePanelLists(built).forEach((l, i) => ctx.positions.saveKey(panelPositionKey(r, 'home', HOME_PANELS[i] ?? String(i)), { selected: l.getSelectedIndex(), scroll: 0 }));
      return;
    }
    if (kind === 'search') {
      searchPanelLists(built).forEach((l, i) => ctx.positions.saveKey(panelPositionKey(r, 'search', SEARCH_PANELS[i] ?? String(i)), { selected: l.getSelectedIndex(), scroll: 0 }));
      return;
    }
    const list = listForRoute(r);
    if (list) {
      ctx.positions.save(r, { selected: list.getSelectedIndex(), scroll: 0 });
    }
  };
  const listForRoute = (r: Route) => {
    const kind = routeKind(r);
    if (kind === 'home') return focusedHomeList(ctx);
    if (kind === 'browse') return built.browseList;
    if (kind === 'search') return focusedSearchList(ctx);
    if (kind === 'library') return built.libraryList;
    if (kind === 'queue') return built.queueList;
    if (kind === 'artist') return built.artistList;
    if (kind === 'album') return built.albumList;
    if (kind === 'playlist') return built.playlistList;
    return null;
  };
  const showRoute = (nextInput: Route | string, force = false, replace = false): void => {
    let next = routeFromLegacy(nextInput);
    const kind = routeKind(next);
    if (!force && state.auth.state !== 'authenticated' && kind !== 'onboarding') {
      const clientRes = resolveClientId();
      if (!clientRes.clientId) {
        ctx.helpers.setStatus('Welcome! Set your Spotify Client ID to begin onboarding');
      } else {
        ctx.helpers.setStatus('Welcome back! Complete authentication to continue');
      }
      next = { kind: 'onboarding' };
    }
    const currentKind = routeKind(route.current);
    if (
      !replace &&
      (currentKind !== kind || JSON.stringify(route.current) !== JSON.stringify(next))
    ) {
      saveRoutePosition(route.current);
      ctx.routeStack = pushRoute(ctx.routeStack, route.current, next);
    }

    route.current = next;
    const finalKind = routeKind(next);

    built.home.visible = finalKind === 'home';
    built.search.visible = finalKind === 'search';
    built.library.visible = finalKind === 'library';
    built.queue.visible = finalKind === 'queue';
    built.lyrics.visible = finalKind === 'lyrics';
    built.settings.visible = finalKind === 'settings';
    built.onboarding.visible = finalKind === 'onboarding';
    // Hero size follows terminal width so the ASCII logo never clips.
    const wideHero = ctx.termWidth.value >= HERO_WIDE_BREAKPOINT;
    built.onboardingHero.visible = finalKind === 'onboarding' && wideHero;
    built.onboardingHeroSmall.visible = finalKind === 'onboarding' && !wideHero;
    built.artist.visible = finalKind === 'artist';
    built.album.visible = finalKind === 'album';
    built.playlist.visible = finalKind === 'playlist';
    built.browse.visible = finalKind === 'browse';
    built.visualizerFull.visible = finalKind === 'visualizer';
    const isVizFull = finalKind === 'visualizer';
    // Login-only mode: unauthenticated users see the settings login page
    // with no sidebar, side panel, or playback bar — like a logged-out web route.
    const loginMode = state.auth.state !== 'authenticated';
    // Responsive tiers: >=120 sidebar visible, 80–119 collapsible via
    // Toggle Sidebar (default visible), <80 drawer (hidden, palette nav).
    const w = ctx.termWidth.value;
    const sidebarByWidth = w >= 120 ? true : w >= 80 ? ctx.sidebarPinned.value : false;
    built.sidebar.visible = !loginMode && !isVizFull && sidebarByWidth;
    built.playbackBar.visible = !loginMode;

    if (manualLyricsScroll.value) { manualLyricsScroll.value = false; if (ctx.lyricsResumeTimer.value) clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout); ctx.lyricsResumeTimer.value = null; built.lyricsResumeHint.visible = false; }
    ctx.helpers.setNavSelected(next);
    if (finalKind === 'lyrics') {
      const availWidth = Math.max(20, (ctx.termWidth.value ?? 80) - (built.sidebar.visible ? 32 : 8));
      const availHeight = ctx.renderer.height ?? 24;
      built.lyricsText.content = renderLyricsStyled(state, { width: availWidth, height: availHeight });
      if (state.lyrics?.kind === 'synced') {
        built.lyricsScroll.scrollTo(0);
      }
    }

    // Narrow terminals stack the 2x2 grids vertically.
    const narrow = ctx.termWidth.value < 80;
    built.homeRow.flexDirection = narrow ? 'column' : 'row';
    built.searchRow.flexDirection = narrow ? 'column' : 'row';

    if (focus.current === 'main') {
      if (finalKind === 'search') {
        blurAllPanels(built);
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else {
        built.searchInput.blur();
        if (finalKind === 'home') {
          focusHomePanel(ctx, ctx.homePanel.value);
        } else {
          blurAllPanels(built);
        }
      }
      if (finalKind === 'settings') {
        ctx.helpers.refreshSettings();
        built.clientIdInput.blur();
      } else {
        built.clientIdInput.blur();
      }
      if (finalKind === 'onboarding') {
        ctx.helpers.refreshOnboarding();
        const clientRes = resolveClientId();
        if (!clientRes.clientId) {
          built.clientIdInput.focus();
        } else {
          built.clientIdInput.blur();
        }
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
        if (finalKind === viewKind) {
          list.focus();
        } else {
          list.blur();
        }
      }
    } else {
      blurAllPanels(built);
      built.searchInput.blur();
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
      // Home/search panels restore per-panel in their setters; single
      // lists restore here against current options.
      const nextKind = routeKind(next);
      const isPanelView = nextKind === 'home' || nextKind === 'search';
      if (!isPanelView) {
        const pos = ctx.positions.restore(next);
        const max = Math.max(0, nextList.options.length - 1);
        nextList.setSelectedIndex(Math.min(Math.max(0, pos.selected), max));
      }
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
      blurAllPanels(built);
      built.searchInput.blur();
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
      if (curKind === 'home') {
        focusHomePanel(ctx, ctx.homePanel.value);
      } else if (curKind === 'browse') {
        built.browseList.focus();
      } else if (curKind === 'search') {
        blurAllPanels(built);
        built.searchInput.focus();
        ctx.helpers.updateSearchFocusVisuals(true);
      } else if (curKind === 'settings') {
        ctx.helpers.refreshSettings();
        built.clientIdInput.blur();
      } else if (curKind === 'onboarding') {
        ctx.helpers.refreshOnboarding();
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

  const getActiveList = (): AnySelect | null => {
    if (ctx.palette.open) return built.paletteList;
    if (ctx.menu.open) return built.menuList;
    if (focus.current === 'sidebar') return built.nav;
    if (focus.current === 'main') return listForRoute(route.current);
    return null;
  };
  const moveActiveList = (delta: number): boolean => {
    const list = getActiveList();
    if (!list) return false;
    if (delta > 0) list.moveDown(delta);
    else if (delta < 0) list.moveUp(-delta);
    return true;
  };
  const jumpActiveList = (to: 'top' | 'bottom', targetIndex?: number): boolean => {
    const list = getActiveList();
    if (!list) return false;
    if (typeof targetIndex === 'number') list.setSelectedIndex(Math.max(0, Math.min(list.options.length - 1, targetIndex)));
    else if (to === 'top') list.setSelectedIndex(0);
    else list.setSelectedIndex(Math.max(0, list.options.length - 1));
    return true;
  };
  return { showRoute, navigateBack, setFocusArea, toggleSidebar, getActiveList, moveActiveList, jumpActiveList };
}
