import { albumTrackOptions, artistAlbumOptions, playlistTrackOptions } from '../views/entities';
import type { UiCoreContext } from './types';

// Entity list setters extracted from api.ts for the 300 LoC cap.
// Append mode keeps the current selection for paging; fresh loads
// re-apply the saved per-route position against the new options.
export function createEntitySetters(ctx: UiCoreContext) {
  const { built } = ctx;
  return {
    setArtistAlbums(
      items: Parameters<import('../types').Ui['setArtistAlbums']>[0],
      opts?: { append?: boolean },
    ): void {
      const rows = artistAlbumOptions(items as never);
      if (opts?.append) {
        ctx.currentRouteItems.value = [...ctx.currentRouteItems.value, ...(items as unknown[])];
        built.artistList.options = [...built.artistList.options, ...rows];
      } else {
        ctx.currentRouteItems.value = items as unknown[];
        built.artistList.options = rows;
        applySavedPosition(ctx, built.artistList);
      }
    },
    setAlbumTracks(
      items: Parameters<import('../types').Ui['setAlbumTracks']>[0],
      opts?: { append?: boolean },
    ): void {
      const rows = albumTrackOptions(items as never);
      if (opts?.append) {
        ctx.currentRouteItems.value = [...ctx.currentRouteItems.value, ...(items as unknown[])];
        built.albumList.options = [...built.albumList.options, ...rows];
      } else {
        ctx.currentRouteItems.value = items as unknown[];
        built.albumList.options = rows;
        applySavedPosition(ctx, built.albumList);
      }
    },
    setPlaylistTracks(
      items: Parameters<import('../types').Ui['setPlaylistTracks']>[0],
      opts?: { append?: boolean },
    ): void {
      const rows = playlistTrackOptions(items as never);
      if (opts?.append) {
        ctx.currentRouteItems.value = [...ctx.currentRouteItems.value, ...(items as unknown[])];
        built.playlistList.options = [...built.playlistList.options, ...rows];
      } else {
        ctx.currentRouteItems.value = items as unknown[];
        built.playlistList.options = rows;
        applySavedPosition(ctx, built.playlistList);
      }
    },
    setArtistHeader(artist: { name: string } | null): void {
      built.artist.title = artist
        ? `Artist: ${artist.name} (Enter: play, x: actions)`
        : 'Artist (Enter: play, x: actions)';
    },
    setAlbumHeader(album: { name: string; artists: Array<{ name: string }> } | null): void {
      const label = album ? `${album.name} — ${album.artists.map((a) => a.name).join(', ')}` : null;
      built.album.title = label ? `Album: ${label} (Enter: play, x: actions)` : 'Album (Enter: play, x: actions)';
    },
    setPlaylistHeader(playlist: { name: string; owner?: { displayName?: string } } | null): void {
      if (playlist) {
        const owner = playlist.owner?.displayName ? ` • ${playlist.owner.displayName}` : '';
        built.playlist.title = `Playlist: ${playlist.name}${owner} (Enter: play, x: actions)`;
      } else {
        built.playlist.title = 'Playlist (Enter: play, x: actions)';
      }
    },
  };
}

function applySavedPosition(
  ctx: UiCoreContext,
  list: { options: unknown[]; setSelectedIndex: (idx: number) => void },
): void {
  const pos = ctx.positions.restore(ctx.route.current);
  const max = Math.max(0, list.options.length - 1);
  list.setSelectedIndex(Math.min(Math.max(0, pos.selected), max));
}
