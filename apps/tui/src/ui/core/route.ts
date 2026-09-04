import { routeTitle } from '../formatters';
import { COLOR_BORDER, COLOR_BORDER_FOCUS } from '../theme';
import { getNavOptions } from '../views/nav';
import { focusedSearchList } from './categoryPanels';
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
    const baseTitle =
      state.auth.state !== 'authenticated' && curKind === 'settings'
        ? 'Setup & Authentication'
        : routeTitle(route.current);

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
    built.nav.options = getNavOptions(state.auth.state === 'authenticated');
    setNavSelected(route.current);
  };

  return { updateSearchFocusVisuals, updateFocusVisuals, setNavSelected, refreshNav };
}
