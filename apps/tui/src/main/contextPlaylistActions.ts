import type { CatalogPlaylistT, CatalogTrackT } from 'spotoei-protocol';
import type { ContextTarget, Ui } from '../ui/types';
import type { AppContext } from './types';
import type { ContextDeps } from './contextMenuItems';

type Deps = AppContext & { contextActions: ContextDeps };

export async function invalidateAndRefreshPlaylist(
  ctx: Deps,
  ui: Ui | null,
  playlistId: string,
): Promise<void> {
  const { clients, state } = ctx;
  clients.entityManager.invalidatePlaylist(playlistId);
  clients.libraryManager.invalidate('playlists');
  if (state.entityPages) delete state.entityPages[`playlist:${playlistId}`];
  const curRoute = ui?.getRoute();
  if (curRoute?.kind === 'playlist' && curRoute.id === playlistId) {
    const fresh = await clients.entityManager.loadPlaylistTracks(playlistId, 0, 100, true);
    ui?.setPlaylistTracks(fresh.items as CatalogTrackT[]);
  }
}

export async function handleAddToPlaylist(
  ctx: Deps,
  ui: Ui | null,
  target: ContextTarget,
): Promise<void> {
  if (!target.uri && !target.id) {
    ui?.setStatus(`Cannot add ${target.name} to playlist: missing URI`, true);
    return;
  }
  const trackUri = target.uri ?? `spotify:track:${target.id}`;
  ui?.setStatus('Loading playlists…');
  try {
    const page = await ctx.clients.libraryManager.getPage('playlists', 0, 50);
    const playlists = (page.items ?? []) as CatalogPlaylistT[];
    if (playlists.length === 0) {
      ui?.setStatus('No playlists found in your library', true);
      return;
    }
    ui?.openContextMenu(
      `Add "${target.name}" to:`,
      playlists.map((pl) => ({
        label: pl.name,
        hint: `${pl.trackCount ?? 0} tracks`,
        run: async () => {
          ui?.setStatus(`Adding "${target.name}" to "${pl.name}"…`);
          try {
            const res = await ctx.clients.webApi.addTracksToPlaylist(pl.id, [trackUri]);
            if (res?.snapshot_id) {
              await invalidateAndRefreshPlaylist(ctx, ui, pl.id);
              ui?.setStatus(`Added "${target.name}" to "${pl.name}"`);
            } else {
              ui?.setStatus(`Failed to add to "${pl.name}"`, true);
            }
          } catch (err) {
            ui?.setStatus(
              `Failed to add: ${err instanceof Error ? err.message : String(err)}`,
              true,
            );
          }
        },
      })),
    );
  } catch (err) {
    ui?.setStatus(
      `Failed to load playlists: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}

export async function handleRemoveFromPlaylist(
  ctx: Deps,
  ui: Ui | null,
  target: ContextTarget,
): Promise<void> {
  if (!target.uri && !target.id) {
    ui?.setStatus(`Cannot remove ${target.name}: missing URI`, true);
    return;
  }
  const trackUri = target.uri ?? `spotify:track:${target.id}`;
  const curRoute = ui?.getRoute();
  const currentPlaylistId = curRoute?.kind === 'playlist' ? curRoute.id : null;
  const doRemove = async (playlistId: string, playlistName?: string) => {
    ui?.setStatus(`Removing "${target.name}"…`);
    try {
      const res = await ctx.clients.webApi.removeTracksFromPlaylist(playlistId, [trackUri]);
      if (res?.snapshot_id) {
        await invalidateAndRefreshPlaylist(ctx, ui, playlistId);
        ui?.setStatus(`Removed "${target.name}"${playlistName ? ` from "${playlistName}"` : ''}`);
      } else {
        ui?.setStatus(`Failed to remove "${target.name}"`, true);
      }
    } catch (err) {
      ui?.setStatus(`Failed to remove: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };
  if (currentPlaylistId) {
    await doRemove(currentPlaylistId);
    return;
  }
  ui?.setStatus('Loading playlists…');
  try {
    const page = await ctx.clients.libraryManager.getPage('playlists', 0, 50);
    const playlists = (page.items ?? []) as CatalogPlaylistT[];
    if (playlists.length === 0) {
      ui?.setStatus('No playlists found in your library', true);
      return;
    }
    ui?.openContextMenu(
      `Remove "${target.name}" from:`,
      playlists.map((pl) => ({
        label: pl.name,
        hint: `${pl.trackCount ?? 0} tracks`,
        run: () => void doRemove(pl.id, pl.name),
      })),
    );
  } catch (err) {
    ui?.setStatus(
      `Failed to load playlists: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}
