import { formatTime } from '../formatters';
import type { UiViewState } from '../types';

export function binarySearchLastLE(
  lines: Array<{ startMs: number }>,
  positionMs: number,
): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = lines[mid]!.startMs;
    if (v <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function getActiveLyricIndex(
  lines: Array<{ startMs: number }>,
  progressMs: number,
): number {
  if (!lines || lines.length === 0 || progressMs < (lines[0]?.startMs ?? 0)) {
    return -1;
  }
  return binarySearchLastLE(lines, progressMs);
}

export function calculateLyricsScrollOffset(
  activeIdx: number,
  viewportHeight = 10,
): number {
  if (activeIdx < 0) return 0;
  return Math.max(0, activeIdx - Math.floor(viewportHeight / 2));
}

export interface LyricsRenderOptions {
  progressMs?: number;
  useAnsi?: boolean;
  autoCenter?: boolean;
  viewportHeight?: number;
}

const ANSI_ACTIVE = '\x1b[1;97m';
const ANSI_DIM = '\x1b[2;90m';
const ANSI_RESET = '\x1b[0m';

export function renderLyricsContent(
  state: UiViewState,
  opts?: LyricsRenderOptions,
): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press l to view, L to reload)';
  }
  if (doc.kind === 'plain') {
    if (doc.lines.length === 0) {
      return '(no plain lyrics text)';
    }
    return doc.lines
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  const curPos =
    opts?.progressMs ??
    (state.playback as { progress_ms?: number } | null | undefined)?.progress_ms ??
    state.playback?.positionMs ??
    0;
  const activeIdx = getActiveLyricIndex(doc.lines, curPos);
  const useAnsi = opts?.useAnsi ?? false;

  let targetLines = doc.lines.map((l, i) => ({ line: l, originalIndex: i }));

  if (opts?.autoCenter && opts.viewportHeight && opts.viewportHeight > 0) {
    const half = Math.floor(opts.viewportHeight / 2);
    const start = Math.max(0, (activeIdx >= 0 ? activeIdx : 0) - half);
    const end = Math.min(doc.lines.length, start + opts.viewportHeight);
    targetLines = targetLines.slice(start, end);
  }

  return targetLines
    .map(({ line: l, originalIndex: i }) => {
      const timeStr = formatTime(l.startMs);
      const isActive = i === activeIdx;
      const prefix = isActive ? '▶ ' : '  ';
      const text = `${prefix}${timeStr}  ${l.text}`;
      if (!useAnsi) {
        return text;
      }
      return isActive
        ? `${ANSI_ACTIVE}${text}${ANSI_RESET}`
        : `${ANSI_DIM}${text}${ANSI_RESET}`;
    })
    .join('\n');
}
