import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import { formatArtists, formatTime } from '../formatters';

export function albumTrackOptions(tracks: CatalogTrackT[]): Array<{
  name: string;
  description: string;
}> {
  return tracks.map((t, idx) => ({
    name: `${String(idx + 1).padStart(2, '0')}. ${t.name}`,
    description: `${formatArtists(t.artists)}  ${formatTime(t.durationMs)}`,
  }));
}

export function playlistTrackOptions(tracks: CatalogTrackT[]): Array<{
  name: string;
  description: string;
}> {
  return tracks.map((t, idx) => ({
    name: `${String(idx + 1).padStart(2, '0')}. ${t.name}`,
    description: `${formatArtists(t.artists)}  ${formatTime(t.durationMs)}`,
  }));
}

export function artistAlbumOptions(albums: CatalogAlbumT[]): Array<{
  name: string;
  description: string;
}> {
  return albums.map((a, idx) => {
    const year = a.releaseDate ? a.releaseDate.slice(0, 4) : '----';
    return {
      name: `${String(idx + 1).padStart(2, '0')}. ${a.name}`,
      description: `${formatArtists(a.artists)} · ${year}`,
    };
  });
}
