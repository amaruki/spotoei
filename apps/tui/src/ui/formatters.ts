import { bold, fg, t } from '@opentui/core';
import { COLOR_ACCENT, COLOR_BAR_PEAK, COLOR_DIM, COLOR_TEXT } from './theme';
import type { Route, UiViewState } from './types';

// Truncate `s` to at most `max` cells, appending an ellipsis when shortened.
export function cap(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 1) return chars.slice(0, max).join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

// Render an `artists` field (string | array of strings | array of {name} |
// undefined) as a flat human-readable string. Anything we can't decode
// becomes empty so we never throw at the boundary.
export function formatArtists(artists?: unknown): string {
  if (!artists) return '—';
  if (typeof artists === 'string') return artists;
  if (!Array.isArray(artists) || artists.length === 0) return '—';
  return artists
    .map((a) => {
      if (typeof a === 'string') return a;
      if (
        a &&
        typeof a === 'object' &&
        'name' in a &&
        typeof (a as { name: unknown }).name === 'string'
      ) {
        return (a as { name: string }).name;
      }
      return String(a ?? '');
    })
    .filter(Boolean)
    .join(', ');
}

export function authSummary(auth: UiViewState['auth']): string {
  const state = String(auth.state ?? 'unauthenticated');
  return `${state} • ${auth.accountId ?? 'no account'} • ${auth.storage ?? 'in-memory'}`;
}

export function routeTitle(route: Route): string {
  const kind = typeof route === 'string' ? route : route.kind;
  switch (kind) {
    case 'home':
      return 'Home';
    case 'browse':
      return 'Browse';
    case 'search':
      return 'Search';
    case 'library':
      return 'Library';
    case 'queue':
      return 'Queue';
    case 'lyrics':
      return 'Lyrics';
    case 'settings':
      return 'Settings';
    case 'visualizer':
      return 'Visualizer';
    case 'artist':
      return 'Artist';
    case 'album':
      return 'Album';
    case 'playlist':
      return 'Playlist';
    case 'onboarding':
      return 'Welcome';
    default:
      return 'Now Playing';
  }
}

// Format milliseconds as `m:ss`. Negative or zero inputs render as "0:00".
export function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Render a styled `m:ss  ─●──  m:ss  (N%)` progress line. Width auto-scales
// inside `totalWidth` so the surrounding layout stays the same regardless
// of label lengths.
export function renderProgressBarStyled(positionMs: number, durationMs: number, totalWidth = 64) {
  const curStr = formatTime(positionMs);
  const durStr = formatTime(durationMs);
  const percent =
    durationMs > 0 ? Math.min(100, Math.max(0, Math.round((positionMs / durationMs) * 100))) : 0;
  const pctStr = `${percent}%`;

  const barWidth = Math.max(12, totalWidth - (curStr.length + durStr.length + pctStr.length + 8));
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const filledCount = Math.round(ratio * barWidth);
  const emptyCount = Math.max(0, barWidth - filledCount);

  const filledStr = filledCount > 1 ? '━'.repeat(filledCount - 1) : '';
  const thumbStr = filledCount > 0 ? '●' : '○';
  const emptyStr = '─'.repeat(emptyCount);

  return t`${fg(COLOR_ACCENT)(bold(curStr))}  ${fg(COLOR_ACCENT)(filledStr)}${fg(COLOR_BAR_PEAK)(bold(thumbStr))}${fg(COLOR_DIM)(emptyStr)}  ${fg(COLOR_TEXT)(durStr)}  ${fg(COLOR_DIM)(`(${pctStr})`)}`;
}
