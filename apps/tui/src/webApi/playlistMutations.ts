// Playlist mutation endpoints: create/add/remove/reorder.
// Verified against developer.spotify.com: POST /users/{id}/playlists,
// POST /playlists/{id}/tracks, DELETE /playlists/{id}/tracks, PUT /playlists/{id}/tracks

import { mapPlaylist } from './mappers';
import { pickObjectKey } from './shape';
import type { Transport } from './transport';
import type { CatalogPlaylistT } from 'spotoei-protocol';

export type PlaylistT = CatalogPlaylistT;

export interface CreatePlaylistOpts {
  public?: boolean;
  collaborative?: boolean;
  description?: string;
}

export async function createPlaylist(
  transport: Transport,
  userId: string,
  name: string,
  description?: string,
  isPublic?: boolean,
): Promise<PlaylistT> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Playlist name required');
  const body: Record<string, unknown> = { name: trimmed };
  if (isPublic !== undefined) body.public = isPublic;
  if (description !== undefined) body.description = description;
  const json = await transport.request(
    `/users/${encodeURIComponent(userId)}/playlists`,
    body,
    'POST',
  );
  const mapped = mapPlaylist(json);
  if (!mapped) throw new Error('Failed to create playlist: invalid response');
  return mapped;
}

export async function addTracksToPlaylist(
  transport: Transport,
  playlistId: string,
  uris: string[],
  position?: number,
): Promise<{ snapshot_id: string }> {
  if (uris.length === 0) return { snapshot_id: '' };
  let lastSnapshot = '';
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const body: Record<string, unknown> = { uris: batch };
    if (position !== undefined) body.position = position + i;
    if (lastSnapshot) body.snapshot_id = lastSnapshot;
    const json = await transport.request(
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      body,
      'POST',
    );
    const sid = pickObjectKey(json, 'snapshot_id');
    if (typeof sid === 'string') {
      lastSnapshot = sid;
    }
  }
  return { snapshot_id: lastSnapshot };
}

export async function removeTracksFromPlaylist(
  transport: Transport,
  playlistId: string,
  uris: string[],
): Promise<{ snapshot_id: string }> {
  if (uris.length === 0) return { snapshot_id: '' };
  let lastSnapshot = '';
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const body: Record<string, unknown> = {
      tracks: batch.map((uri) => ({ uri })),
    };
    if (lastSnapshot) body.snapshot_id = lastSnapshot;
    const json = await transport.request(
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      body,
      'DELETE',
    );
    const sid = pickObjectKey(json, 'snapshot_id');
    if (typeof sid === 'string') {
      lastSnapshot = sid;
    }
  }
  return { snapshot_id: lastSnapshot };
}

export async function reorderPlaylistTracks(
  transport: Transport,
  playlistId: string,
  rangeStart: number,
  insertBefore: number,
  rangeLength = 1,
): Promise<{ snapshot_id: string }> {
  if (!Number.isInteger(rangeStart) || rangeStart < 0) throw new Error('invalid rangeStart');
  if (!Number.isInteger(insertBefore) || insertBefore < 0) throw new Error('invalid insertBefore');
  if (!Number.isInteger(rangeLength) || rangeLength < 1) throw new Error('invalid rangeLength');
  const ins = insertBefore > rangeStart ? insertBefore + rangeLength : insertBefore;
  if (ins === rangeStart) throw new Error('noop reorder');
  if (insertBefore > rangeStart && insertBefore < rangeStart + rangeLength) throw new Error('insert inside range');
  const body: Record<string, unknown> = {
    range_start: rangeStart,
    insert_before: ins,
    range_length: rangeLength,
  };
  const json = await transport.request(
    `/playlists/${encodeURIComponent(playlistId)}/tracks`,
    body,
    'PUT',
  );
  const sid = pickObjectKey(json, 'snapshot_id');
  return { snapshot_id: typeof sid === 'string' ? sid : '' };
}

export class PlaylistMutations {
  constructor(private transport: Transport) {}

  async createPlaylist(
    userId: string,
    name: string,
    opts: CreatePlaylistOpts = {},
  ): Promise<PlaylistT | null> {
    if (opts.collaborative && opts.public) throw new Error('collaborative playlists must be private');
    try {
      return await createPlaylist(
        this.transport,
        userId,
        name,
        opts.description,
        opts.public,
      );
    } catch {
      return null;
    }
  }

  async addToPlaylist(
    playlistId: string,
    uris: string[],
    position?: number,
  ): Promise<string | null> {
    const res = await addTracksToPlaylist(this.transport, playlistId, uris, position);
    return res.snapshot_id || null;
  }

  async removeFromPlaylist(
    playlistId: string,
    uris: string[],
  ): Promise<string | null> {
    const res = await removeTracksFromPlaylist(this.transport, playlistId, uris);
    return res.snapshot_id || null;
  }

  async reorderPlaylist(
    playlistId: string,
    rangeStart: number,
    insertBefore: number,
    rangeLength = 1,
  ): Promise<string | null> {
    const res = await reorderPlaylistTracks(this.transport, playlistId, rangeStart, insertBefore, rangeLength);
    return res.snapshot_id || null;
  }
}
