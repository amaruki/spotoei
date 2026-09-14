import { routeTitle } from '../formatters';
import { COLOR_BORDER, COLOR_BORDER_FOCUS } from '../theme';
import { getNavOptions } from '../views/nav';
import {
  focusedSearchList,
  homePanelBoxes,
  homePanelLists,
  searchPanelBoxes,
  searchPanelLists,
} from './categoryPanels';
import { routeKind } from './navigationStack';
import type { Route, UiCoreContext } from './types';

// All route / focus / nav selection helpers. They all read state through
// `ctx` and mutate it in place so the rest of the controller sees updates.
export function createRouteHelpers(ctx: UiCoreContext) {
  const { built, focus, route, state } = ctx;

  const updateSearchFocusVisuals = (inputFocused: boolean): void => {
    if (inputFocused) {
      built.searchInputBox.borderColor = COLOR_BORDER_FOCUS;
      built.searchInputBox.title = '▶ Search Spotify (Type query & press Enter)';
      built.searchResultsBox.borderColor = COLOR_BORDER;
      built.searchResultsBox.title = 'Results (Press ↓ for tracks, Tab: category)';
    } else {
      built.searchInputBox.borderColor = COLOR_BORDER;
      built.searchInputBox.title = 'Search Spotify (Press ↑ to edit query)';
      built.searchResultsBox.borderColor = COLOR_BORDER_FOCUS;
      built.searchResultsBox.title = '▶ Results (↑/↓ browse, Tab: category, Enter: play)';
    }
  };

  const updateFocusVisuals = (): void => {
    const curKind = routeKind(route.current);
    const baseTitle = routeTitle(route.current);

    if (focus.current === 'sidebar') {
      built.sidebar.borderColor = COLOR_BORDER_FOCUS;
      built.sidebar.title = '▶ Navigation [Active]';
      built.main.borderColor = COLOR_BORDER;
      built.main.title = baseTitle;
      if (curKind === 'search') {
        built.searchInputBox.borderColor = COLOR_BORDER;
        built.searchResultsBox.borderColor = COLOR_BORDER;
      }
      built.library.borderColor = COLOR_BORDER;
      built.queue.borderColor = COLOR_BORDER;
      // panels not color-only: show active marker even when sidebar focused? keep blur state
      for (const b of [...homePanelBoxes(built), ...searchPanelBoxes(built)]) {
        const base = (b as unknown as { id?: string }).id?.includes('home-tracks')
          ? 'Top Tracks'
          : (b as unknown as { id?: string }).id?.includes('home-artists')
            ? 'Top Artists'
            : (b as unknown as { id?: string }).id?.includes('home-recent')
              ? 'Recently Played'
              : (b as unknown as { id?: string }).id?.includes('home-discover')
                ? 'Discover'
                : (b as unknown as { id?: string }).id?.includes('search-tracks')
                  ? 'Tracks'
                  : (b as unknown as { id?: string }).id?.includes('search-artists')
                    ? 'Artists'
                    : (b as unknown as { id?: string }).id?.includes('search-albums')
                      ? 'Albums'
                      : 'Playlists';
        b.borderColor = COLOR_BORDER;
        b.title = base;
      }
    } else {
      built.sidebar.borderColor = COLOR_BORDER;
      built.sidebar.title = 'Navigation';
      built.main.borderColor = COLOR_BORDER_FOCUS;
      built.main.title = `▶ ${baseTitle} [Active]`;
      if (curKind === 'search') {
        updateSearchFocusVisuals(built.searchInput.focused || !focusedSearchList(ctx).focused);
      }
      built.library.borderColor = curKind === 'library' ? COLOR_BORDER_FOCUS : COLOR_BORDER;
      built.queue.borderColor = curKind === 'queue' ? COLOR_BORDER_FOCUS : COLOR_BORDER;
      // ensure active panel shows ▶ [Active] when main focused
      if (curKind === 'home') {
        const boxes = homePanelBoxes(built);
        const lists = homePanelLists(built);
        const active = ctx.homePanel.value;
        boxes.forEach((box, i) => {
          const isActive = i === active;
          const base =
            (box as unknown as { title?: string }).title
              ?.replace(/^▶\s*/, '')
              .replace(/\s*\[Active\]$/, '') || 'Panel';
          // fallback to known titles
          const known = ['Top Tracks', 'Top Artists', 'Recently Played', 'Discover'][i] ?? base;
          box.title = isActive ? `▶ ${known} [Active]` : known;
          box.borderColor = isActive ? COLOR_BORDER_FOCUS : COLOR_BORDER;
          if (isActive) lists[i]?.focus();
          else lists[i]?.blur();
        });
      } else if (curKind === 'search') {
        const boxes = searchPanelBoxes(built);
        const lists = searchPanelLists(built);
        const active = ctx.searchPanel.value;
        boxes.forEach((box, i) => {
          const isActive = i === active;
          const known = ['Tracks', 'Artists', 'Albums', 'Playlists'][i] ?? 'Panel';
          box.title = isActive ? `▶ ${known} [Active]` : known;
          box.borderColor = isActive ? COLOR_BORDER_FOCUS : COLOR_BORDER;
          if (isActive) lists[i]?.focus();
          else lists[i]?.blur();
        });
      }
    }
  };

  const setNavSelected = (target: Route): void => {
    const options = built.nav.options;
    const targetKind = routeKind(target);
    const idx = options.findIndex((o) => o.value === targetKind);
    if (idx >= 0 && built.nav.getSelectedIndex() !== idx) {
      built.nav.setSelectedIndex(idx);
    }
  };

  const refreshNav = (): void => {
    built.nav.options = getNavOptions(
      state.auth.state === 'authenticated',
      Boolean(state.isPrivateSession),
    );
    setNavSelected(route.current);
  };

  return { updateSearchFocusVisuals, updateFocusVisuals, setNavSelected, refreshNav };
}
