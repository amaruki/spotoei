import type { SearchHitT, SearchResponseT } from 'spotoei-protocol';
import { formatArtists, formatTime } from '../formatters';
import { STALE_PREFIX, STALE_SUFFIX } from '../theme';

// Search results render as one panel per category (Tracks / Artists /
// Albums / Playlists / Shows / Episodes). Partitioning keeps the original
// hit index so selection handlers map panel rows back to hits.
export type SearchFilter = 'all' | 'track' | 'artist' | 'album' | 'playlist' | 'show' | 'episode';

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
  shows: SearchHitRef[];
  episodes: SearchHitRef[];
}

export function partitionSearchHits(
  hits: SearchResponseT['hits'],
  filter: SearchFilter = 'all',
): SearchPanels {
  const panels: SearchPanels = {
    tracks: [],
    artists: [],
    albums: [],
    playlists: [],
    shows: [],
    episodes: [],
  };
  hits.forEach((h, index) => {
    if (filter !== 'all' && h.type !== filter) return;
    const ref = { hit: h, index };
    if (h.type === 'track') panels.tracks.push(ref);
    else if (h.type === 'artist') panels.artists.push(ref);
    else if (h.type === 'album') panels.albums.push(ref);
    else if (h.type === 'playlist') panels.playlists.push(ref);
    else if (h.type === 'show') panels.shows.push(ref);
    else if (h.type === 'episode') panels.episodes.push(ref);
  });
  return panels;
}
export function renderHit(h: SearchHitT, opts?: { savedIds?: Set<string>; playingUri?: string | null; isStale?: boolean }): SearchListRow {
  const stale = opts?.isStale ? STALE_SUFFIX : '';
  const dimPrefix = opts?.isStale ? STALE_PREFIX : '';
  if (h.type === 'track') {
    const playing = opts?.playingUri && h.track.uri === opts.playingUri ? '▶ ' : '';
    const explicit = h.track.isExplicit ? '[E] ' : '';
    const saved = opts?.savedIds?.has(h.track.uri) || opts?.savedIds?.has(h.track.id) ? '♥ ' : '';
    const artists = formatArtists(h.track.artists);
    const album = h.track.albumName ? ` — ${h.track.albumName}` : '';
    const dur = typeof h.track.durationMs === 'number' && h.track.durationMs > 0 ? `  ${formatTime(h.track.durationMs)}` : '';
    return {
      name: `${dimPrefix}${playing}${explicit}${saved}♪ ${h.track.name}${stale}`,
      description: `${artists}${album}${dur}${h.track.isPlayable === false ? ' · unavailable' : ''}`,
    };
  }
  if (h.type === 'album') {
    const artists = formatArtists(h.album.artists);
    return {
      name: `${dimPrefix}◈ ${h.album.name}${stale}`,
      description: `${artists} (album)`,
    };
  }
  if (h.type === 'artist') {
    return {
      name: `${dimPrefix}👤 ${h.artist.name}${stale}`,
      description: `${h.artist.followers ?? 0} followers (artist)`,
    };
  }
  if (h.type === 'playlist') {
    return {
      name: `${dimPrefix}☰ ${h.playlist.name}${stale}`,
      description: `${h.playlist.trackCount ?? 0} tracks (playlist)`,
    };
  }
  if (h.type === 'show') {
    const eps = typeof h.show.totalEpisodes === 'number' ? ` · ${h.show.totalEpisodes} eps` : '';
    return {
      name: `${dimPrefix}🎙 ${h.show.name}${stale}`,
      description: `${h.show.publisher ?? 'podcast'}${eps}`,
    };
  }
  if (h.type === 'episode') {
    const dur =
      typeof h.episode.durationMs === 'number' && h.episode.durationMs > 0
        ? `  ${formatTime(h.episode.durationMs)}`
        : '';
    const explicit = h.episode.isExplicit ? '[E] ' : '';
    return {
      name: `${dimPrefix}🎧 ${explicit}${h.episode.name}${stale}`,
      description: `${h.episode.releaseDate ?? 'episode'}${dur}`,
    };
  }
  return {
    name: `${dimPrefix}☰ ${(h as unknown as { playlist?: { name: string } }).playlist?.name ?? 'Unknown'}${stale}`,
    description: '',
  };
}
