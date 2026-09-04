import { fg, t } from '@opentui/core';
import { COLOR_TEXT } from '../theme';
import type { ContextMenuItem, ContextTarget, FocusArea, LibraryItemT } from '../types';
import { partitionHomeRows } from '../views/homeRows';
import { routeKind } from './navigationStack';
import type { UiCoreContext } from './types';

type EntityLike = { id?: string; uri?: string; name?: string };

function asEntity(value: unknown): EntityLike | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' ? v.id : undefined;
  const uri = typeof v.uri === 'string' ? v.uri : undefined;
  const name = typeof v.name === 'string' ? v.name : undefined;
  if (!id) return null;
  return { id, uri, name };
}

// Resolve the entity under the focused list for the current route.
// Returns null when nothing actionable is selected.
export function resolveContextTarget(ctx: UiCoreContext): ContextTarget | null {
  const { built, route } = ctx;
  const kind = routeKind(route.current);
  if (kind === 'search') {
    const panels = ['tracks', 'artists', 'albums', 'playlists'] as const;
    const panel = panels[ctx.searchPanel.value] ?? 'tracks';
    const lists = {
      tracks: built.searchTracksList,
      artists: built.searchArtistsList,
      albums: built.searchAlbumsList,
      playlists: built.searchPlaylistsList,
    };
    const hitIdx = ctx.searchPanelMaps.value[panel][lists[panel]?.getSelectedIndex() ?? 0];
    if (hitIdx === undefined) return null;
    const hit = ctx.currentSearchHits.value[hitIdx] as
      | {
          type: string;
          track?: EntityLike;
          album?: EntityLike;
          artist?: EntityLike;
          playlist?: EntityLike;
        }
      | undefined;
    if (!hit) return null;
    const entity = hit.track ?? hit.album ?? hit.artist ?? hit.playlist;
    if (!entity?.id) return null;
    const targetKind =
      hit.type === 'track'
        ? 'track'
        : hit.type === 'album'
          ? 'album'
          : hit.type === 'artist'
            ? 'artist'
            : 'playlist';
    return { kind: targetKind, id: entity.id, uri: entity.uri, name: entity.name ?? entity.id };
  }
  if (kind === 'library') {
    const item = ctx.currentLibraryItems.value[built.libraryList.getSelectedIndex()] as
      | (LibraryItemT & { uri: string })
      | undefined;
    if (!item?.id) return null;
    const targetKind =
      'durationMs' in item
        ? 'track'
        : item.uri.startsWith('spotify:album:')
          ? 'album'
          : item.uri.startsWith('spotify:artist:')
            ? 'artist'
            : 'playlist';
    return { kind: targetKind, id: item.id, uri: item.uri, name: item.name };
  }
  if (kind === 'artist' || kind === 'album' || kind === 'playlist') {
    const list =
      kind === 'artist'
        ? built.artistList
        : kind === 'album'
          ? built.albumList
          : built.playlistList;
    const entity = asEntity(ctx.currentRouteItems.value[list.getSelectedIndex()]);
    if (!entity?.id) return null;
    const targetKind = kind === 'artist' ? 'album' : 'track';
    return { kind: targetKind, id: entity.id, uri: entity.uri, name: entity.name ?? entity.id };
  }
  if (kind === 'home' && (route.current as { browse?: unknown }).browse === undefined) {
    const parts = partitionHomeRows(ctx.currentHomeItems.value as never) as unknown as Record<
      string,
      Array<{ kind: string; track?: EntityLike; artist?: EntityLike; id?: string; label?: string }>
    >;
    const groups = [parts.tracks, parts.artists, parts.recent, parts.discover];
    const lists = [
      built.homeTracksList,
      built.homeArtistsList,
      built.homeRecentList,
      built.homeDiscoverList,
    ];
    const panel = Math.max(0, Math.min(3, ctx.homePanel.value));
    const row = groups[panel]?.[lists[panel]?.getSelectedIndex() ?? 0];
    if (row?.kind === 'discover' && row.id) {
      return { kind: 'browse-entry', id: row.id, name: row.label ?? row.id };
    }
    if (row?.kind === 'track' && row.track?.id) {
      return {
        kind: 'track',
        id: row.track.id,
        uri: row.track.uri,
        name: row.track.name ?? row.track.id,
      };
    }
    if (row?.kind === 'artist' && row.artist?.id) {
      return {
        kind: 'artist',
        id: row.artist.id,
        uri: row.artist.uri,
        name: row.artist.name ?? row.artist.id,
      };
    }
    return null;
  }
  const browse = (route.current as { browse?: { category?: string } }).browse;
  if (kind === 'home' && browse?.category) {
    const entry = asEntity(ctx.currentRouteItems.value[built.browseList.getSelectedIndex()]) as
      | (EntityLike & { label?: string })
      | null;
    if (!entry?.id) return null;
    return { kind: 'browse-entry', id: entry.id, name: entry.label ?? entry.name ?? entry.id };
  }
  return null;
}

// Entity-anchored context menu (x). Keeps the selected entity visible
// behind the overlay and restores focus to the originating area on close.
export function createContextMenuHelpers(ctx: UiCoreContext) {
  const { built, focus } = ctx;

  const openContextMenu = (title: string, items: ContextMenuItem[]): void => {
    ctx.menu.open = true;
    ctx.menu.prevFocus = focus.current;
    ctx.menu.items = items;
    built.menuTitle.content = t`${fg(COLOR_TEXT)(title)}`;
    built.menuList.options = items.map((item) => ({
      name: item.disabled ? `○ ${item.label}` : `• ${item.label}`,
      description: item.disabled ? (item.reason ?? 'Unavailable') : (item.hint ?? ''),
    }));
    built.menuList.setSelectedIndex(0);
    built.menu.visible = true;
    built.menuList.focus();
  };

  const closeContextMenu = (): void => {
    if (!ctx.menu.open) return;
    ctx.menu.open = false;
    ctx.menu.items = [];
    built.menu.visible = false;
    built.menuList.blur();
    ctx.helpers.setFocusArea(ctx.menu.prevFocus as FocusArea);
  };

  const isContextMenuOpen = (): boolean => ctx.menu.open;

  const runMenuSelected = (): void => {
    const idx = built.menuList.getSelectedIndex();
    const item = ctx.menu.items[idx];
    if (!item) {
      closeContextMenu();
      return;
    }
    if (item.disabled) {
      ctx.helpers.setStatus(item.reason ?? `${item.label} is unavailable`, true);
      return;
    }
    closeContextMenu();
    try {
      item.run();
    } catch (err) {
      ctx.helpers.setStatus(`action: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return { openContextMenu, closeContextMenu, isContextMenuOpen, runMenuSelected };
}
