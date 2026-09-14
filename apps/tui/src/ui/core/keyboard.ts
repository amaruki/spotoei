import { resolveBackAction } from '../../navigation/backBehavior';
import { DEFAULT_CLIENT_ID, resolveClientId } from '../../config';
import { HOME_PANELS, cycleHomePanel, focusedHomeList, focusHomePanel } from './categoryPanels';
import { handleEntityBrowseKeys } from './keyboardEntity';
import { handleLibraryQueueKeys } from './keyboardLists';
import { handleOverlayKeys } from './keyboardOverlays';
import { handleSearchKeys } from './keyboardSearch';
import { createMotionAccumulator, handleVimMotion } from './keyboardMotion';
import { routeKind } from './navigationStack';
import type { Route, UiCoreContext } from './types';
// Key dispatcher for the full TUI. Implements focus isolation: when an
// input is focused or the palette is open, keystrokes are swallowed so they
// do not trigger global hotkeys (like Space to pause or 'q' to quit).
export function createKeyDispatcher(ctx: UiCoreContext) {
  const { built, focus, manualLyricsScroll, opts, palette, route, state } = ctx;
  const sched = (): void => {
    if (!state.lyrics || state.lyrics.kind !== 'synced') return;
    built.lyricsResumeHint.visible = manualLyricsScroll.value;
    if (ctx.lyricsResumeTimer.value)
      clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout);
    if (manualLyricsScroll.value)
      ctx.lyricsResumeTimer.value = setTimeout(() => {
        manualLyricsScroll.value = false;
        built.lyricsResumeHint.visible = false;
        ctx.helpers.setStatus('Resumed lyric sync');
      }, 5000);
    else if (ctx.lyricsResumeTimer.value) {
      clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout);
      ctx.lyricsResumeTimer.value = null;
    }
  };
  const resume = (): void => {
    if (!manualLyricsScroll.value) return;
    if (ctx.lyricsResumeTimer.value)
      clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout);
    ctx.lyricsResumeTimer.value = null;
    manualLyricsScroll.value = false;
    built.lyricsResumeHint.visible = false;
    ctx.helpers.setStatus('Resumed lyric sync');
  };
  const motionAcc = createMotionAccumulator();
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

    if (handleOverlayKeys(ctx, e)) return;

    // 2. Search route input focus isolation (split for LoC cap)
    if (handleSearchKeys(ctx, e, key)) {
      return;
    }

    // 3. Onboarding Client ID input isolation (input lives in the
    // onboarding view; auth no longer happens on the settings page)
    if (built.clientIdInput.focused) {
      if (e.ctrl && e.name === 'c') {
        opts.onKey(key);
        return;
      }
      if (e.ctrl && (e.name === 'd' || e.name === 'D')) {
        built.clientIdInput.value = '';
        built.clientIdInput.blur();
        if (opts.onSaveClientId) {
          void opts.onSaveClientId(DEFAULT_CLIENT_ID);
        }
        ctx.helpers.refreshOnboarding();
        return;
      }
      if (e.name === 'escape' || e.name === 'tab') {
        built.clientIdInput.blur();
        ctx.helpers.setFocusArea('main');
        return;
      }
      // Characters/spaces typed into clientIdInput must NOT trigger global hotkeys!
      return;
    }

    if (
      routeKind(route.current) === 'onboarding' &&
      focus.current === 'main' &&
      !built.clientIdInput.focused
    ) {
      if (state.streamingPending) {
        if (
          e.name === 'return' ||
          e.name === 'a' ||
          e.name === 'A' ||
          e.sequence === 'a' ||
          e.sequence === 'A'
        ) {
          if (opts.onAuthenticate) {
            void opts.onAuthenticate();
          }
          return;
        }
      } else if (state.auth.state === 'authenticated') {
        if (
          (!e.ctrl && (e.name === 'l' || e.name === 'L')) ||
          (e.ctrl && (e.name === 'l' || e.name === 'L'))
        ) {
          if (opts.onLogout) {
            void opts.onLogout();
            return;
          }
        }
        if (e.name === 'escape') {
          ctx.helpers.showRoute('home');
          return;
        }
        if (e.name === 'a' || e.name === 'A' || e.sequence === 'a' || e.sequence === 'A') {
          if (opts.onAuthenticate) {
            void opts.onAuthenticate();
          }
          return;
        }
      } else {
        if (e.name === 'd' || e.name === 'D') {
          if (opts.onSaveClientId) {
            void opts.onSaveClientId(DEFAULT_CLIENT_ID);
          }
          ctx.helpers.refreshOnboarding();
          return;
        }
        if (e.name === 'a' || e.name === 'A' || e.sequence === 'a' || e.sequence === 'A') {
          if (opts.onAuthenticate) {
            void opts.onAuthenticate();
          }
          return;
        }
        if (e.name === 'return') {
          const clientRes = resolveClientId(false);
          if (clientRes.clientId) {
            if (opts.onAuthenticate) {
              void opts.onAuthenticate();
            }
            return;
          }
          built.clientIdInput.focus();
          return;
        }
      }
      if (e.name === 'escape' || e.name === 'tab' || e.name === 'left') {
        if (built.sidebar.visible) {
          ctx.helpers.setFocusArea('sidebar');
        }
        return;
      }
      if (e.name === 'c' || e.name === 'i') {
        built.clientIdInput.focus();
        return;
      }
    }
    // Vim motion handling: digits, gg, G, j, k, down, up, PageDown, PageUp
    if (handleVimMotion(ctx, e, motionAcc, sched)) {
      return;
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
      if (
        e.name === 'up' ||
        e.name === 'k' ||
        e.name === 'down' ||
        e.name === 'j' ||
        e.name === 'return'
      ) {
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

    // 4e. Home category panels: Tab cycles panels, arrows stay in-list.
    if (routeKind(route.current) === 'home' && focus.current === 'main') {
      if (e.name === 'tab') {
        if (e.shift) {
          const len = HOME_PANELS.length;
          const prev = (ctx.homePanel.value - 1 + len) % len;
          focusHomePanel(ctx, prev);
        } else {
          cycleHomePanel(ctx);
        }
        return;
      }
      const homeList = focusedHomeList(ctx);
      if (
        ['up', 'down', 'j', 'k', 'return', 'pageup', 'pagedown', 'home', 'end'].includes(e.name)
      ) {
        void homeList;
        return;
      }
    }

    // 5. Context exit keys. Esc resolves through resolveBackAction:
    // overlay closes first, browse/entity/lyrics/visualizer pop one
    // history level per Esc (forward nav pushes each level).
    if (focus.current === 'main') {
      if (e.name === 'escape' || e.name === 'left') {
        const cur = route.current as unknown as {
          kind: string;
          path?: { category?: string; entry?: string };
        };
        const action = resolveBackAction({
          route: route.current,
          browse: cur.path ?? {},
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
        const order = ['sidebar', 'main'] as const;
        const idx = order.indexOf(focus.current as (typeof order)[number]);
        if (e.shift) {
          const prev = (idx - 1 + order.length) % order.length;
          ctx.helpers.setFocusArea(order[prev] as typeof focus.current);
        } else {
          const next = (idx + 1) % order.length;
          ctx.helpers.setFocusArea(order[next] as typeof focus.current);
        }
        return;
      }
    }
    if (routeKind(route.current) === 'lyrics' && focus.current === 'main') {
      if (e.name === 'r' || e.name === 'R' || e.name === 'return') {
        if (manualLyricsScroll.value) resume();
        return;
      }
    }

    if (opts.onKey) {
      opts.onKey(key);
    }
  };
}
