import type { CatalogAlbumT, CatalogArtistT, CatalogPlaylistT } from 'spotoei-protocol';
import { formatArtists } from '../formatters';
import type { LibraryItemT } from '../types';

export function libraryItemOptions(
  items: LibraryItemT[],
  error?: { code: string; message: string },
): { name: string; description: string }[] {
  if (error) {
    return [{ name: `⚠ Library Error: ${error.code}`, description: error.message }];
  }
  if (items.length === 0) {
    return [
      {
        name: '(library empty)',
        description: 'No saved tracks found. Save songs on Spotify or press r to refresh.',
      },
    ];
  }
  return items.map((item) => {
    if ('durationMs' in item) {
      const artists = formatArtists(item.artists);
      const album = item.albumName ? ` — ${item.albumName}` : '';
      return {
        name: `♪ ${item.name}`,
        description: `${artists}${album}`,
      };
    }
    if ('albumGroup' in item || ('images' in item && 'artists' in item)) {
      const artists = formatArtists((item as CatalogAlbumT).artists);
      return {
        name: `◈ ${item.name}`,
        description: `${artists} (album)`,
      };
    }
    if ('followers' in item) {
      return {
        name: `👤 ${item.name}`,
        description: `${(item as CatalogArtistT).followers ?? 0} followers (artist)`,
      };
    }
    return {
      name: `☰ ${item.name}`,
      description: `${(item as CatalogPlaylistT).trackCount ?? 0} tracks (playlist)`,
    };
  });
}
