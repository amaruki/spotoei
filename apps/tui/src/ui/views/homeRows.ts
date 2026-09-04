import type { CatalogArtistT, CatalogTrackT } from 'spotoei-protocol';
import { formatArtists } from '../formatters';
import { formatTime } from '../formatters';

export type HomeRow =
  | { kind: 'context'; text: string }
  | { kind: 'header'; text: string }
  | { kind: 'track'; track: CatalogTrackT; playedAt?: string; saved?: boolean }
  | { kind: 'artist'; artist: CatalogArtistT; track?: CatalogTrackT }
  | { kind: 'discover'; id: string; label: string; description: string; track?: CatalogTrackT };

export function homeRowOptions(
  rows: HomeRow[],
  emptyLabel = '(nothing here yet)',
): Array<{ name: string; description: string }> {
  if (rows.length === 0) {
    return [{ name: emptyLabel, description: 'Try another Home tab' }];
  }
  return rows.map((row) => {
    switch (row.kind) {
      case 'context':
        return { name: `▶ ${row.text}`, description: 'Now playing' };
      case 'header':
        return { name: `── ${row.text} ──`, description: '' };
      case 'artist': {
        if ((row as { track?: CatalogTrackT }).track) {
          const t = (row as { track: CatalogTrackT }).track;
          return { name: `♪ ${t.name}`, description: `${formatArtists(t.artists)} · ${formatTime(t.durationMs)} · ${row.artist.name}` };
        }
        return { name: `👤 ${row.artist.name}`, description: 'Enter: open artist' };
      }
      case 'discover': {
        if (row.track) {
          return { name: `♪ ${row.track.name}`, description: `${formatArtists(row.track.artists)} · ${formatTime(row.track.durationMs)} · ${row.label}` };
        }
        return { name: `▸ ${row.label}`, description: row.description };
      }
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

export interface HomePanels {
  tracks: HomeRow[];
  artists: HomeRow[];
  recent: HomeRow[];
  discover: HomeRow[];
}

type PanelKey = keyof HomePanels;

const PANEL_CAPS: Record<PanelKey, number> = {
  tracks: 8,
  artists: 6,
  recent: 6,
  discover: 6,
};

// Explicit section routing: headers claim the panel for subsequent rows,
// so Top Tracks never starve Recently Played and preview tracks never
// leak into Top Artists. Content rows without a preceding header fall
// back by kind (playedAt → recent, track → tracks, artist → artists,
// discover → discover). Each panel caps its content rows; headers ride
// along uncounted.
export function partitionHomeRows(rows: HomeRow[]): HomePanels {
  const panels: HomePanels = { tracks: [], artists: [], recent: [], discover: [] };
  const contentCount: Record<PanelKey, number> = { tracks: 0, artists: 0, recent: 0, discover: 0 };
  let current: PanelKey | null = null;

  const headerPanel = (text: string): PanelKey | 'all' | null => {
    const t = text.toLowerCase();
    if (t.startsWith('top tracks')) return 'tracks';
    if (t.startsWith('top artists')) return 'artists';
    if (t.startsWith('recently played')) return 'recent';
    if (t.startsWith('discover')) return 'discover';
    if (t.startsWith('loading')) return 'all';
    return null;
  };

  const naturalPanel = (row: HomeRow): PanelKey => {
    if (row.kind === 'artist') return 'artists';
    if (row.kind === 'discover') return 'discover';
    if (row.kind === 'track') {
      if (row.playedAt) return 'recent';
      // Plain tracks belong to Top Tracks or the Discover preview — the
      // preceding section header disambiguates; default to Top Tracks.
      if (current === 'tracks' || current === 'recent' || current === 'discover') {
        return current;
      }
      return 'tracks';
    }
    return current ?? 'tracks';
  };

  for (const row of rows) {
    if (row.kind === 'header' || row.kind === 'context') {
      if (row.kind === 'context') {
        panels.tracks.push(row);
        continue;
      }
      const target = headerPanel(row.text);
      if (target === 'all') {
        for (const key of ['tracks', 'artists', 'recent', 'discover'] as const) {
          panels[key].push(row);
        }
        current = null;
      } else if (target) {
        panels[target].push(row);
        current = target;
      } else {
        (current ? panels[current] : panels.tracks).push(row);
      }
      continue;
    }
    const panel = naturalPanel(row);
    if (contentCount[panel] >= PANEL_CAPS[panel]) {
      // Overflow spills to discover, which never blocks other panels.
      if (panel !== 'discover' && contentCount.discover < PANEL_CAPS.discover) {
        panels.discover.push(row);
        contentCount.discover += 1;
      }
      continue;
    }
    panels[panel].push(row);
    contentCount[panel] += 1;
  }
  return panels;
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
