// Selection routing: tracks play, albums/artists/playlists open pages.

import type { CatalogTrackT, SearchHitT } from 'spotoei-protocol';
import { entityRouteForHit } from '../entities/actions';
import type { LibraryItemT, Ui } from '../ui';

export function routeForLibraryItem(item: LibraryItemT): { kind: 'album' | 'artist' | 'playlist'; id: string } | null {
  if ('durationMs' in item) return null;
  if (!item.uri) return null;
  if (item.uri.startsWith('spotify:album:')) return { kind: 'album', id: item.id };
  if (item.uri.startsWith('spotify:artist:')) return { kind: 'artist', id: item.id };
  if (item.uri.startsWith('spotify:playlist:')) return { kind: 'playlist', id: item.id };
  return null;
}

export function handleSearchHitSelect(
  hit: SearchHitT,
  ui: Ui | null,
  onPlayTrack: (track: CatalogTrackT) => void,
): boolean {
  const route = entityRouteForHit(hit);
  if (route && ui) {
    ui.setRoute(route);
    return true;
  }
  if (hit.type === 'track') {
    onPlayTrack(hit.track);
    return true;
  }
  return false;
}
