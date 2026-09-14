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
  const isBrowseList = kind === 'browse';
  if ((isEntityList || isBrowseList) && focus.current === 'main') {
    if (e.ctrl) {
      return false;
    }
    if (
      e.name === 'up' ||
      e.name === 'k' ||
      e.name === 'down' ||
      e.name === 'j' ||
      e.name === 'return'
    ) {
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
    // Browse Esc levels resolve through the history stack: forward
    // navigation pushes each level, so generic navigateBack steps one
    // level per Esc. See resolveBackAction for the documented mapping.
    if ((e.name === 'v' || e.name === 'V') && !built.clientIdInput.focused) {
      toggleVisualizerRoute(ctx);
      return true;
    }
    if (e.name === 'm' || e.name === 'M') {
      if (ctx.opts.onCycleVisualizerMode) {
        ctx.opts.onCycleVisualizerMode();
      } else {
        const order = ['spectrum', 'winamp', 'oscilloscope', 'circular', 'off'] as const;
        const curMode = state.visualizer.mode as (typeof order)[number];
        const next = order[(order.indexOf(curMode) + 1) % order.length] ?? 'spectrum';
        state.visualizer.mode = next as typeof state.visualizer.mode;
        ctx.helpers.setVizTitle();
        ctx.helpers.setStatus(`Visualizer mode: ${next}`);
      }
      return true;
    }
  }
  return false;
}

// Single visualizer-route toggle for in-renderer keys. The main-layer
// handler (main/keys.ts) performs the equivalent Ui calls for keys that
// arrive via the global onKey fallback (e.g. sidebar focus).
export function toggleVisualizerRoute(ctx: UiCoreContext): void {
  if (routeKind(ctx.route.current) === 'visualizer') {
    ctx.helpers.navigateBack();
    ctx.helpers.setStatus('Exited visualizer');
  } else {
    ctx.helpers.showRoute({ kind: 'visualizer' });
    ctx.helpers.setStatus(`Visualizer (${ctx.state.visualizer.mode}) — V: close, m: mode`);
  }
}
