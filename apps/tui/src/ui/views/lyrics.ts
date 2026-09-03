import { formatTime } from '../formatters';
import type { UiViewState } from '../types';

export function renderLyricsContent(state: UiViewState): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press l to view, L to reload)';
  }
  if (doc.kind === 'plain') {
    return doc.lines.map((l) => l.text).join('\n\n');
  }
  const curPos = state.playback?.positionMs ?? 0;
  let activeIdx = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    if (line && line.startMs <= curPos) {
      activeIdx = i;
    } else {
      break;
    }
  }

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
