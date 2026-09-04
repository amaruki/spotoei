import { formatArtists } from '../formatters';
import type { SearchResponseT } from 'spotoei-protocol';

// Map a `SearchResponseT` to grouped rows in the results SelectRenderable.
// Group headers carry indexMap -1 so selection handlers never mistake them
// for hits. Errors and empty results yield a single explanatory row.
export type SearchFilter = 'all' | 'track' | 'artist' | 'album' | 'playlist';

export interface SearchListRow {
  name: string;
  description: string;
}

function fail(rows: SearchListRow[]): { options: SearchListRow[]; indexMap: number[] } {
  return { options: rows, indexMap: rows.map(() => -1) };
}

export function searchHitOptions(
  results: SearchResponseT,
  filter: SearchFilter = 'all',
): { options: SearchListRow[]; indexMap: number[] } {
  if (results.error) {
    return fail([
      {
        name: `⚠ ${results.error.code}`,
        description: results.error.message,
      },
    ]);
  }
  const hits = results.hits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => filter === 'all' || h.type === filter);
  if (hits.length === 0) {
    return fail([
      {
        name: '(no results)',
        description: 'No Spotify matches',
      },
    ]);
  }
  const options: SearchListRow[] = [];
  const indexMap: number[] = [];
  const groups: Array<{ type: string; title: string }> = [
    { type: 'track', title: 'Tracks' },
    { type: 'artist', title: 'Artists' },
    { type: 'album', title: 'Albums' },
    { type: 'playlist', title: 'Playlists' },
  ];
  for (const group of groups) {
    const members = hits.filter(({ h }) => h.type === group.type);
    if (members.length === 0) continue;
    if (filter === 'all') {
      options.push({ name: `── ${group.title} ──`, description: '' });
      indexMap.push(-1);
    }
    for (const { h, i } of members) {
      options.push(renderHit(h));
      indexMap.push(i);
    }
  }
  return { options, indexMap };
}

function renderHit(h: SearchResponseT['hits'][number]): SearchListRow {
  if (h.type === 'track') {
    const artists = formatArtists(h.track.artists);
    const album = h.track.albumName ? ` — ${h.track.albumName}` : '';
    return {
      name: `♪ ${h.track.name}`,
      description: `${artists}${album}`,
    };
  }
  if (h.type === 'album') {
    const artists = formatArtists(h.album.artists);
    return {
      name: `◈ ${h.album.name}`,
      description: `${artists} (album)`,
    };
  }
  if (h.type === 'artist') {
    return {
      name: `👤 ${h.artist.name}`,
      description: `${h.artist.followers ?? 0} followers (artist)`,
    };
  }
  return {
    name: `☰ ${h.playlist.name}`,
    description: `${h.playlist.trackCount ?? 0} tracks (playlist)`,
  };
}
