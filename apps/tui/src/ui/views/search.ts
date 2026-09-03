import { formatArtists } from '../formatters';
import type { SearchResponseT } from 'spotoei-protocol';

// Map a `SearchResponseT` to the rows displayed in the results SelectRenderable.
// Errors and empty results yield a single explanatory row rather than an
// empty list so the user always sees feedback.
export function searchHitOptions(results: SearchResponseT): { name: string; description: string }[] {
  if (results.error) {
    return [
      {
        name: `⚠ ${results.error.code}`,
        description: results.error.message,
      },
    ];
  }
  if (results.hits.length === 0) {
    return [
      {
        name: '(no results)',
        description: 'No Spotify matches',
      },
    ];
  }
  return results.hits.map((h) => {
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
  });
}
