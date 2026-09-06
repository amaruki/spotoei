import { routeKind } from './navigationStack';
import type { Route, UiCoreContext } from './types';

export interface MotionAccumulator {
  countBuffer: string;
  pendingG: boolean;
  timer: NodeJS.Timeout | null;
}

export function createMotionAccumulator(): MotionAccumulator {
  return { countBuffer: '', pendingG: false, timer: null };
}

export function resetAccumulator(acc: MotionAccumulator): void {
  if (acc.timer) {
    clearTimeout(acc.timer);
    acc.timer = null;
  }
  acc.countBuffer = '';
  acc.pendingG = false;
}
export function parseMotionCount(buffer: string): number {
  if (!buffer) return 1;
  const parsed = parseInt(buffer, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(parsed, 999);
}


export const NUM_ROUTES: Record<string, Route> = {
  '1': { kind: 'home', tab: 'for_you' },
  '2': { kind: 'browse', path: {} },
  '3': { kind: 'search' },
  '4': { kind: 'library', section: 'saved_tracks' },
  '5': { kind: 'queue' },
  '6': { kind: 'lyrics' },
  '7': { kind: 'settings' },
};

export function isInputFocused(ctx: UiCoreContext): boolean {
  const { built, palette, route } = ctx;
  if (palette.open && built.paletteInput.focused) return true;
  if (built.clientIdInput.focused) return true;
  if (routeKind(route.current) === 'search' && built.searchInput.focused) return true;
  return false;
}

export function handleVimMotion(
  ctx: UiCoreContext,
  e: { name: string; sequence: string; ctrl: boolean; shift: boolean; meta: boolean },
  acc: MotionAccumulator,
  sched: () => void,
): boolean {
  if (isInputFocused(ctx) || e.ctrl || e.meta) {
    resetAccumulator(acc);
    return false;
  }

  if (e.name === 'escape') {
    if (acc.countBuffer || acc.pendingG) {
      resetAccumulator(acc);
      return true;
    }
    return false;
  }

  const { built, focus, manualLyricsScroll, route } = ctx;
  const isLyrics = routeKind(route.current) === 'lyrics' && focus.current === 'main';

  // 1. Numerical digits (0-9): accumulate into buffer
  if (e.name >= '0' && e.name <= '9') {
    if (acc.countBuffer.length < 3) {
      acc.countBuffer += e.name;
    }
    acc.pendingG = false;
    if (acc.timer) clearTimeout(acc.timer);
    const timeoutMs = ctx.opts.vimTimeoutMs ?? 1000;
    acc.timer = setTimeout(() => {
      const digits = acc.countBuffer;
      resetAccumulator(acc);
      const dest = NUM_ROUTES[digits];
      if (dest) {
        ctx.helpers.showRoute(dest);
        ctx.helpers.setFocusArea('main');
      }
    }, timeoutMs);
    return true;
  }

  // 2. 'g' key (lowercase): start pending gg or complete gg
  if (e.name === 'g' && !e.shift && e.sequence === 'g') {
    if (acc.pendingG) {
      const targetIdx = acc.countBuffer ? parseMotionCount(acc.countBuffer) - 1 : 0;
      resetAccumulator(acc);
      if (isLyrics) {
        manualLyricsScroll.value = true;
        built.lyricsScroll.scrollTo(0);
        sched();
      } else {
        ctx.helpers.jumpActiveList('top', targetIdx);
      }
      return true;
    }
    acc.pendingG = true;
    if (acc.timer) clearTimeout(acc.timer);
    acc.timer = setTimeout(() => {
      resetAccumulator(acc);
    }, ctx.opts.vimTimeoutMs ?? 1000);
    return true;
  }

  // 3. 'G' key (uppercase Shift+G): jump to bottom (or line index)
  if (e.name === 'G' || (e.shift && (e.name === 'g' || e.name === 'G')) || e.sequence === 'G') {
    const targetIdx = acc.countBuffer ? parseMotionCount(acc.countBuffer) - 1 : undefined;
    resetAccumulator(acc);
    if (isLyrics) {
      manualLyricsScroll.value = true;
      built.lyricsScroll.scrollTo(999999);
      sched();
    } else {
      ctx.helpers.jumpActiveList('bottom', targetIdx);
    }
    return true;
  }

  // 4. Motion commands: j, k, down, up, pagedown, pageup
  const name = (e.name ?? '').toLowerCase();
  const isMotion = ['j', 'k', 'down', 'up', 'pagedown', 'pageup'].includes(name);

  if (isMotion) {
    const count = parseMotionCount(acc.countBuffer);
    resetAccumulator(acc);

    if (isLyrics) {
      manualLyricsScroll.value = true;
      if (name === 'j' || name === 'down') built.lyricsScroll.scrollBy(2 * count);
      else if (name === 'k' || name === 'up') built.lyricsScroll.scrollBy(-2 * count);
      else if (name === 'pagedown') built.lyricsScroll.scrollBy(10 * count);
      else if (name === 'pageup') built.lyricsScroll.scrollBy(-10 * count);
      sched();
      return true;
    }

    if (name === 'j' || name === 'down') {
      if (count > 1) ctx.helpers.moveActiveList(count - 1);
      return true;
    }
    if (name === 'k' || name === 'up') {
      if (count > 1) ctx.helpers.moveActiveList(-(count - 1));
      return true;
    }
    if (name === 'pagedown') {
      ctx.helpers.moveActiveList(5 * count);
      return true;
    }
    if (name === 'pageup') {
      ctx.helpers.moveActiveList(-5 * count);
      return true;
    }
  }

  // 5. Non-motion keys (e.g. Esc): reset buffer and pass through
  if (acc.countBuffer || acc.pendingG) {
    resetAccumulator(acc);
  }
  return false;
}
