import { formatArtists } from '../formatters';
import type { SearchHitT, SearchResponseT } from 'spotoei-protocol';

// Search results render as one panel per category (Tracks / Artists /
// Albums / Playlists). Partitioning keeps the original hit index so
// selection handlers map panel rows back to hits.
export type SearchFilter = 'all' | 'track' | 'artist' | 'album' | 'playlist';

export interface SearchListRow {
  name: string;
  description: string;
}

export interface SearchHitRef {
  hit: SearchHitT;
  index: number;
}

export interface SearchPanels {
  tracks: SearchHitRef[];
  artists: SearchHitRef[];
  albums: SearchHitRef[];
  playlists: SearchHitRef[];
}

export function partitionSearchHits(
  hits: SearchResponseT['hits'],
  filter: SearchFilter = 'all',
): SearchPanels {
  const panels: SearchPanels = { tracks: [], artists: [], albums: [], playlists: [] };
  hits.forEach((h, index) => {
    if (filter !== 'all' && h.type !== filter) return;
    const ref = { hit: h, index };
    if (h.type === 'track') panels.tracks.push(ref);
    else if (h.type === 'artist') panels.artists.push(ref);
    else if (h.type === 'album') panels.albums.push(ref);
    else panels.playlists.push(ref);
  });
  return panels;
}

export function renderHit(h: SearchHitT): SearchListRow {
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
