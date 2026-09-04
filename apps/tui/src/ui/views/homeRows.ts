import type { CatalogArtistT, CatalogTrackT } from 'spotoei-protocol';
import { formatArtists } from '../formatters';
import { formatTime } from '../formatters';

export type HomeRow =
  | { kind: 'context'; text: string }
  | { kind: 'header'; text: string }
  | { kind: 'track'; track: CatalogTrackT; playedAt?: string; saved?: boolean }
  | { kind: 'artist'; artist: CatalogArtistT };

export function homeRowOptions(rows: HomeRow[]): Array<{ name: string; description: string }> {
  if (rows.length === 0) {
    return [{ name: '(nothing here yet)', description: 'Try another Home tab' }];
  }
  return rows.map((row) => {
    switch (row.kind) {
      case 'context':
        return { name: `▶ ${row.text}`, description: 'Now playing' };
      case 'header':
        return { name: `── ${row.text} ──`, description: '' };
      case 'artist':
        return { name: `👤 ${row.artist.name}`, description: 'Enter: open artist' };
      case 'track': {
        const local = row.playedAt ? ` · ${formatPlayedAt(row.playedAt)}` : '';
        const liked = row.saved ? ' ♥' : '';
        return {
          name: `♪ ${row.track.name}${liked}`,
          description: `${formatArtists(row.track.artists)} · ${formatTime(row.track.durationMs)}${local}`,
        };
      }
    }
  });
}

export function formatPlayedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function contextLine(trackName?: string, artists?: unknown, state?: string): string | null {
  if (!trackName) return null;
  return `${trackName} — ${formatArtists(artists)} [${state ?? 'idle'}]`;
}
