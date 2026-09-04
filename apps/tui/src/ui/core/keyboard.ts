import { resolveBackAction } from '../../navigation/backBehavior';
import { resolveClientId } from '../../config';
import { handleEntityBrowseKeys } from './keyboardEntity';
import { handleLibraryQueueKeys } from './keyboardLists';
import { routeKind } from './navigationStack';
import type { Route, UiCoreContext } from './types';
// Key dispatcher for the full TUI. Implements focus isolation: when an
// input is focused or the palette is open, keystrokes are swallowed so they
// do not trigger global hotkeys (like Space to pause or 'q' to quit).
export function createKeyDispatcher(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, palette, route, state } = ctx;
  return (e: {
    name: string;
    sequence: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
  }): void => {
    const key = {
      name: e.name,
      sequence: e.sequence,
      ctrl: e.ctrl,
      shift: e.shift,
      meta: e.meta,
      raw: e.sequence,
    };

    // 1. Palette open takes absolute keyboard precedence
    if (palette.open) {
      if (e.name === 'escape' || (e.ctrl && e.name === 'c')) {
        ctx.helpers.setPaletteOpen(false);
        return;
      }
      if (e.name === 'up') {
        const cur = built.paletteList.getSelectedIndex();
        built.paletteList.setSelectedIndex(Math.max(0, cur - 1));
        return;
      }
      if (e.name === 'down') {
        const cur = built.paletteList.getSelectedIndex();
        const max = Math.max(0, built.paletteList.options.length - 1);
        built.paletteList.setSelectedIndex(Math.min(max, cur + 1));
        return;
      }
      if (e.name === 'return') {
        const idx = built.paletteList.getSelectedIndex();
        const cmd = palette.filtered[idx];
        ctx.helpers.setPaletteOpen(false);
        if (cmd) {
          try {
            cmd.action();
          } catch (err) {
            ctx.helpers.setStatus(`palette: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return;
      }
      // Typing characters are consumed by paletteInput; do NOT trigger global hotkeys!
      return;
    }

    // 1b. Context menu captures keys while open; Esc/X closes it and
    // restores focus to the originating list.
    if (ctx.menu.open) {
      if (e.name === 'escape' || e.name === 'x' || e.name === 'X' || (e.ctrl && e.name === 'c')) {
        ctx.helpers.closeContextMenu();
        return;
      }
      if (e.name === 'up') {
        const cur = built.menuList.getSelectedIndex();
        built.menuList.setSelectedIndex(Math.max(0, cur - 1));
        return;
      }
      if (e.name === 'down') {
        const cur = built.menuList.getSelectedIndex();
        const max = Math.max(0, built.menuList.options.length - 1);
        built.menuList.setSelectedIndex(Math.min(max, cur + 1));
        return;
      }
      if (e.name === 'return') {
        ctx.helpers.runMenuSelected();
        return;
      }
      return;
    }

    // 2. Search route input focus isolation
    if (routeKind(route.current) === 'search' && focus.current === 'main') {
      if (built.searchInput.focused) {
        if (e.ctrl && e.name === 'c') {
          opts.onKey(key);
          return;
        }
        if (e.name === 'escape' || e.name === 'tab') {
          built.searchInput.blur();
          ctx.helpers.setFocusArea('sidebar');
          return;
        }
        if (e.name === 'down') {
          built.searchInput.blur();
          built.searchResults.focus();
          ctx.helpers.updateSearchFocusVisuals(false);
          return;
        }
        if (e.name === 'return') {
          // Handled natively by InputRenderable.submit(), emitting InputRenderableEvents.ENTER
          return;
        }
        // Characters/spaces typed into searchInput are consumed here; do NOT trigger global hotkeys!
        return;
      }
      if (built.searchResults.focused) {
        if (e.ctrl && e.name === 'c') {
          opts.onKey(key);
          return;
        }
        if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
          built.searchResults.blur();
          ctx.helpers.setFocusArea('sidebar');
          return;
        }
        if (e.name === 'up' && built.searchResults.getSelectedIndex() === 0) {
          built.searchResults.blur();
          built.searchInput.focus();
          ctx.helpers.updateSearchFocusVisuals(true);
          return;
        }
        if (!e.shift && (e.name === '/' || e.name === 's' || e.sequence === '/')) {
          built.searchResults.blur();
          built.searchInput.focus();
          ctx.helpers.updateSearchFocusVisuals(true);
          return;
        }
        if (['up', 'down', 'return', 'pageup', 'pagedown', 'home', 'end'].includes(e.name)) {
          // Let SelectRenderable handle arrow/enter events for playing tracks
          return;
        }
      }
      // If neither is focused while in search route, focus search input
      built.searchInput.focus();
      ctx.helpers.updateSearchFocusVisuals(true);
      return;
    }

    // 3. Settings route Client ID input isolation
    if (routeKind(route.current) === 'settings' && built.clientIdInput.focused) {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (e.name === 'escape' || e.name === 'tab') {
        built.clientIdInput.blur();
        ctx.helpers.setFocusArea('sidebar');
        return;
      }
      // Characters/spaces typed into clientIdInput must NOT trigger global hotkeys!
      return;
    }

    if (
      routeKind(route.current) === 'settings' &&
      focus.current === 'main' &&
      !built.clientIdInput.focused
    ) {
      if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
        ctx.helpers.setFocusArea('sidebar');
        return;
      }
      if (!e.shift && (e.name === 'a' || e.sequence === 'a')) {
        if (opts.onAuthenticate) {
          void opts.onAuthenticate();
        }
        return;
      }
      if (e.name === 'return') {
        const clientRes = resolveClientId();
        if (clientRes.clientId && state.auth.state !== 'authenticated') {
          if (opts.onAuthenticate) {
            void opts.onAuthenticate();
          }
          return;
        }
        built.clientIdInput.focus();
        return;
      }
      if (e.name === 'c' || e.name === 'i') {
        built.clientIdInput.focus();
        return;
      }
    }

    // 4. Sidebar navigation focus handling
    if (focus.current === 'sidebar') {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (
        state.auth.state !== 'authenticated' &&
        (e.name === 'a' || e.name === 'A' || e.sequence === 'a' || e.sequence === 'A')
      ) {
        if (opts.onAuthenticate) {
          void opts.onAuthenticate();
        }
        return;
      }
      if (e.name === 'tab' || e.name === 'right') {
        const sel = built.nav.getSelectedOption();
        const target = sel?.value as Route | undefined;
        if (target) {
          ctx.helpers.showRoute(target);
        }
        ctx.helpers.setFocusArea('main');
        return;
      }
      if (e.name === 'up' || e.name === 'down' || e.name === 'return') {
        // SelectRenderable handles up/down navigation and return selection
        return;
      }
    }

    // 4b-4c. Library / queue list focus handling (split for LoC cap)
    if (handleLibraryQueueKeys(ctx, e, key)) {
      return;
    }

    // 4d. Entity / browse / visualizer keys (split for LoC cap)
    if (handleEntityBrowseKeys(ctx, e)) {
      return;
    }

    // 5. Context exit keys. Esc resolves through resolveBackAction:
    // overlay closes first, browse/entity/lyrics/visualizer pop one
    // history level per Esc (forward nav pushes each level).
    if (focus.current === 'main') {
      if (e.name === 'escape' || e.name === 'left') {
        const cur = route.current as unknown as {
          kind: string;
          browse?: { category?: string; entry?: string };
        };
        const action = resolveBackAction({
          route: route.current,
          browse: cur.browse ?? {},
          overlayOpen: ctx.menu.open,
          paletteOpen: palette.open,
        });
        if (action === 'close_overlay') {
          if (ctx.menu.open) ctx.helpers.closeContextMenu();
          else ctx.helpers.setPaletteOpen(false);
          return;
        }
        if (ctx.helpers.navigateBack()) {
          return;
        }
        ctx.helpers.setFocusArea('sidebar');
        return;
      }
      if (e.name === 'tab') {
        ctx.helpers.setFocusArea('sidebar');
        return;
      }
    }

    // 6. Quick number navigation when not typing in an input
    if (routeKind(route.current) !== 'search' && !built.clientIdInput.focused) {
      const numRoutes: Record<string, Route> = {
        '1': { kind: 'home', tab: 'for_you' },
        '2': { kind: 'search' },
        '3': { kind: 'library', section: 'saved_tracks' },
        '4': { kind: 'queue' },
        '5': { kind: 'lyrics' },
        '6': { kind: 'settings' },
      };
      const dest = numRoutes[e.name];
      if (dest) {
        ctx.helpers.showRoute(dest);
        ctx.helpers.setFocusArea('main');
        return;
      }
    }
    // 7. Lyrics scroll navigation
    if (routeKind(route.current) === 'lyrics' && focus.current === 'main') {
      if (e.name === 'up' || e.name === 'k') {
        manualLyricsScroll.value = true;
        built.lyricsScroll.scrollBy(-2);
        return;
      }
      if (e.name === 'down' || e.name === 'j') {
        manualLyricsScroll.value = true;
        built.lyricsScroll.scrollBy(2);
        return;
      }
    }

    if (opts.onKey) {
      opts.onKey(key);
    }
  };
}
