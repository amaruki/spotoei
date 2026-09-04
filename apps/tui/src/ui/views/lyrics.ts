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

export function renderLyricsContent(state: UiViewState): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press l to view, L to reload)';
  }
  if (doc.kind === 'plain') {
    return doc.lines.map((l) => l.text).join('\n\n');
  }
  const curPos = state.playback?.positionMs ?? 0;
  const activeIdx = binarySearchLastLE(doc.lines, curPos);

  return doc.lines
    .map((l, i) => {
      const timeStr = formatTime(l.startMs);
      if (i === activeIdx) {
        return `▶ ${timeStr}  ${l.text}`;
      }
      return `  ${timeStr}  ${l.text}`;
    })
    .join('\n');
}
