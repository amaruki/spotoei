import { routeKind } from './navigationStack';
import type { UiCoreContext } from './types';

// Entity / browse / visualizer keys extracted to respect the 300 LoC cap.
// Returns true when the key was consumed.
export function handleEntityBrowseKeys(
  ctx: UiCoreContext,
  e: { name: string; sequence: string; ctrl: boolean },
): boolean {
  const { built, focus, opts, palette, route, state } = ctx;
  const kind = routeKind(route.current);
  const isEntityList =
    kind === 'artist' || kind === 'album' || kind === 'playlist' || kind === 'visualizer';
  const isBrowseList =
    kind === 'home' && (route.current as { browse?: unknown }).browse !== undefined;
  if ((isEntityList || isBrowseList) && focus.current === 'main') {
    if (e.ctrl) {
      return false;
    }
    if (e.name === 'up' || e.name === 'down' || e.name === 'return') {
      return true;
    }
    if (e.name === 'x' || e.name === 'X') {
      opts.onKey({
        name: e.name,
        sequence: e.sequence,
        ctrl: false,
        shift: false,
        meta: false,
        raw: e.sequence,
      });
      return true;
    }
  }

  if (focus.current === 'main' && !palette.open) {
    const cur = route.current as unknown as {
      kind: string;
      tab?: string;
      browse?: { category?: string; entry?: string };
    };
    if (cur.kind === 'home' && cur.tab === 'browse') {
      if (e.name === 'escape' && cur.browse?.entry) {
        ctx.helpers.showRoute({
          kind: 'home',
          tab: 'browse',
          browse: { category: cur.browse.category },
        });
        return true;
      }
      if (e.name === 'escape' && cur.browse?.category) {
        ctx.helpers.showRoute({ kind: 'home', tab: 'browse' });
        return true;
      }
    }
    if ((e.name === 'v' || e.name === 'V') && !built.clientIdInput.focused) {
      if (cur.kind === 'visualizer') {
        ctx.helpers.navigateBack();
      } else {
        ctx.helpers.showRoute({ kind: 'visualizer' });
      }
      return true;
    }
    if (e.name === 'm' || e.name === 'M') {
      const order = ['spectrum', 'winamp', 'oscilloscope', 'off'] as const;
      const curMode = state.visualizer.mode as (typeof order)[number];
      const next = order[(order.indexOf(curMode) + 1) % order.length] ?? 'spectrum';
      state.visualizer.mode = next as typeof state.visualizer.mode;
      ctx.helpers.setVizTitle();
      ctx.helpers.setStatus(`Visualizer mode: ${next}`);
      return true;
    }
  }
  return false;
}
