import { routeKind } from './navigationStack';
import type { KeyDispatch, UiCoreContext } from './types';

// Library / queue list focus handling extracted to respect the 300 LoC cap.
// Returns true when the key was consumed, false to let navigateBack handle Esc.
export function handleLibraryQueueKeys(
  ctx: UiCoreContext,
  e: { name: string; ctrl: boolean; shift?: boolean },
  key: Parameters<KeyDispatch>[0],
): boolean {
  const { focus, opts, route } = ctx;
  const kind = routeKind(route.current);
  if (kind !== 'library' && kind !== 'queue') return false;
  if (focus.current !== 'main') return false;
  if (e.ctrl && e.name === 'c') {
    opts.onKey(key);
    return true;
  }
  if (e.name === 'escape') {
    return false;
  }
  if (e.name === 'tab') {
    // Shift+Tab reverse traversal
    if (e.shift) {
      ctx.helpers.setFocusArea('sidebar');
      return true;
    }
    ctx.helpers.setFocusArea('sidebar');
    return true;
  }
  if (e.name === 'left') {
    ctx.helpers.setFocusArea('sidebar');
    return true;
  }
  if (kind === 'library' && (e.name === 'r' || e.name === 'R')) {
    opts.onKey(key);
    return true;
  }
  if (
    e.name === 'up' ||
    e.name === 'k' ||
    e.name === 'down' ||
    e.name === 'j' ||
    e.name === 'return'
  ) {
    // SelectRenderable handles list scrolling and enter selection
    return true;
  }
  return false;
}
