import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogPlaylistT,
  CatalogTrackT,
} from 'spotoei-protocol';
import { formatArtists, formatTime } from '../formatters';
import { STALE_PREFIX, STALE_SUFFIX } from '../theme';
import { QUOTA_BANNER } from '../../webApi/transport';
import type { LibraryItemT } from '../types';
import {
  type PlaylistFolderNode,
  isPlaylistFolderNode,
  toggleFolderExpanded,
  setFolderExpanded,
  flattenPlaylistTree,
} from '../../library/collections';

export {
  type PlaylistFolderNode,
  isPlaylistFolderNode,
  toggleFolderExpanded,
  setFolderExpanded,
  flattenPlaylistTree,
};

type AnyLibraryItem =
  | LibraryItemT
  | CatalogTrackT
  | CatalogAlbumT
  | CatalogArtistT
  | CatalogPlaylistT
  | PlaylistFolderNode
  | { id: string; name: string; publisher?: string; totalEpisodes?: number; depth?: number };
export const LIBRARY_FOOTER_LOAD_MORE = '-- Load more --';
export const LIBRARY_FOOTER_END = '-- End of library --';
export function isLibraryFooterIndex(
  selected: number,
  itemsLength: number,
  hasMore?: boolean,
): boolean {
  if (hasMore === undefined) return false;
  return selected === itemsLength;
}
export function libraryItemOptions(
  items: AnyLibraryItem[],
  error?: { code: string; message: string },
  opts?: {
    hasMore?: boolean;
    savedIds?: Set<string>;
    playingUri?: string | null;
    isStale?: boolean;
  },
): { name: string; description: string }[] {
  if (error) {
    const isQuota =
      error.code === 'QUOTA_EXCEEDED' ||
      error.code === 'API_QUOTA_EXCEEDED' ||
      /quota/i.test(error.code) ||
      /quota/i.test(error.message);
    const msg = isQuota ? QUOTA_BANNER : error.message;
    return [{ name: `\u26a0 Library Error: ${error.code}`, description: msg }];
  }
  if (items.length === 0)
    return [
      {
        name: `${opts?.isStale ? STALE_PREFIX : ''}(library empty)${opts?.isStale ? STALE_SUFFIX : ''}`,
        description: 'No saved tracks found. Save songs on Spotify or press r to refresh.',
      },
    ];
  const rows = items.map((item) => {
    const stale = opts?.isStale ? STALE_SUFFIX : '';
    const dim = opts?.isStale ? STALE_PREFIX : '';
    if ('durationMs' in item) {
      const track = item as CatalogTrackT;
      const playing = opts?.playingUri && track.uri === opts.playingUri ? '▶ ' : '';
      const explicit = track.isExplicit ? '[E] ' : '';
      const saved = opts?.savedIds?.has(track.uri) || opts?.savedIds?.has(track.id) ? '♥ ' : '';
      const artists = formatArtists(track.artists);
      const album = track.albumName ? ` — ${track.albumName}` : '';
      const dur =
        typeof track.durationMs === 'number' && track.durationMs > 0
          ? `  ${formatTime(track.durationMs)}`
          : '';
      return {
        name: `${dim}${playing}${explicit}${saved}♪ ${track.name}${stale}`,
        description: `${artists}${album}${dur}${track.isPlayable === false ? ' · unavailable' : ''}`,
      };
    }
    if ('albumGroup' in item || ('images' in item && 'artists' in item)) {
      const artists = formatArtists((item as CatalogAlbumT).artists);
      return { name: `${dim}◈ ${item.name}${stale}`, description: `${artists} (album)` };
    }
    if ('followers' in item)
      return {
        name: `${dim}👤 ${item.name}${stale}`,
        description: `${(item as CatalogArtistT).followers ?? 0} followers (artist)`,
      };
    if (
      'publisher' in (item as Record<string, unknown>) ||
      'totalEpisodes' in (item as Record<string, unknown>)
    ) {
      const show = item as { name: string; publisher?: string; totalEpisodes?: number };
      return {
        name: `${dim}🎙 ${show.name}${stale}`,
        description: `${show.publisher ?? 'podcast'}${show.totalEpisodes ? ` \u00b7 ${show.totalEpisodes} episodes` : ''}`,
      };
    }
    if (isPlaylistFolderNode(item)) {
      const depth =
        typeof (item as { depth?: number }).depth === 'number'
          ? (item as { depth?: number }).depth!
          : 0;
      const indent = depth > 0 ? '  '.repeat(depth) : '';
      const icon = item.isExpanded ? '📂 ' : '📁 ';
      const count = item.children.length;
      const countStr = `${count} ${count === 1 ? 'item' : 'items'}`;
      const stateStr = item.isExpanded ? 'expanded' : 'collapsed';
      return {
        name: `${dim}${indent}${icon}${item.name}${stale}`,
        description: `${countStr} (folder · ${stateStr})`,
      };
    }
    const depth =
      typeof (item as { depth?: number }).depth === 'number'
        ? (item as { depth?: number }).depth!
        : 0;
    const indent = depth > 0 ? '  '.repeat(depth) : '';
    return {
      name: `${dim}${indent}☰ ${item.name}${stale}`,
      description: `${(item as CatalogPlaylistT).trackCount ?? 0} tracks (playlist)`,
    };
  });
  if (opts?.hasMore !== undefined)
    rows.push(
      opts.hasMore
        ? {
            name: LIBRARY_FOOTER_LOAD_MORE,
            description: 'Press Enter to load more (also scroll to end)',
          }
        : { name: LIBRARY_FOOTER_END, description: `${items.length} items total` },
    );
  return rows;
}

export function toggleLibraryFolder(items: AnyLibraryItem[], folderId: string): AnyLibraryItem[] {
  return toggleFolderExpanded(
    items as Array<PlaylistFolderNode | CatalogPlaylistT>,
    folderId,
  ) as AnyLibraryItem[];
}
export function findLibraryIndexById(items: AnyLibraryItem[], id: string): number {
  return items.findIndex((it) => (it as { id?: string }).id === id);
}
