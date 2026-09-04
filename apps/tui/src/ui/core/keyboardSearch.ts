import { SEARCH_PANELS, cycleSearchPanel, focusedSearchList, focusSearchPanel } from './categoryPanels';
import { routeKind } from './navigationStack';
import type { KeyDispatch, UiCoreContext } from './types';

export interface SearchKeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
}

// Search route input focus isolation extracted to respect the 300 LoC cap.
// Returns true when the key was consumed.
export function handleSearchKeys(
  ctx: UiCoreContext,
  e: SearchKeyEvent,
  key: Parameters<KeyDispatch>[0],
): boolean {
  const { built, focus, opts, route } = ctx;
  if (routeKind(route.current) !== 'search' || focus.current !== 'main') return false;
  if (built.searchInput.focused) {
    if (e.ctrl && e.name === 'c') {
      opts.onKey(key);
      return true;
    }
    if (e.name === 'escape') {
      return false;
    }
    if (e.name === 'tab') {
      built.searchInput.blur();
      // Shift+Tab reverse: keep sidebar focus but distinguish direction
      void e.shift;
      ctx.helpers.setFocusArea('sidebar');
      return true;
    }
    if (e.name === 'down' || e.name === 'j') {
      built.searchInput.blur();
      focusSearchPanel(ctx, ctx.searchPanel.value);
      ctx.helpers.updateSearchFocusVisuals(false);
      return true;
    }
    if (e.name === 'return') {
      // Handled natively by InputRenderable.submit(), emitting InputRenderableEvents.ENTER
      return true;
    }
    // Characters/spaces typed into searchInput are consumed here; do NOT trigger global hotkeys!
    return true;
  }
  const searchList = focusedSearchList(ctx);
  if (searchList.focused) {
    if (e.ctrl && e.name === 'c') {
      opts.onKey(key);
      return true;
    }
    if (e.name === 'tab') {
      if (e.shift) {
        const len = SEARCH_PANELS.length;
        const prev = (ctx.searchPanel.value - 1 + len) % len;
        focusSearchPanel(ctx, prev);
      } else {
        cycleSearchPanel(ctx);
      }
      return true;
    }
    if (e.name === 'escape') {
      return false;
    }
    if (e.name === 'left') {
      searchList.blur();
      ctx.helpers.setFocusArea('sidebar');
      return true;
    }
    if ((e.name === 'up' || e.name === 'k') && searchList.getSelectedIndex() === 0) {
      searchList.blur();
      built.searchInput.focus();
      ctx.helpers.updateSearchFocusVisuals(true);
      return true;
    }
    if (!e.shift && (e.name === '/' || e.name === 's' || e.sequence === '/')) {
      searchList.blur();
      built.searchInput.focus();
      ctx.helpers.updateSearchFocusVisuals(true);
      return true;
    }
    if (['up', 'down', 'j', 'k', 'return', 'pageup', 'pagedown', 'home', 'end'].includes(e.name)) {
      // Let SelectRenderable handle arrow/enter events for playing tracks
      return true;
    }
  }
  // If neither is focused while in search route, focus search input
  built.searchInput.focus();
  ctx.helpers.updateSearchFocusVisuals(true);
  return true;
}
