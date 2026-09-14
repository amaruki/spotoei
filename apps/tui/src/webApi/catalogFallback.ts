// Fallback for the deprecated /recommendations endpoint (404 for dev apps
// without Extended Quota since Nov 2024). Extracted from catalog.ts so the
// endpoint class body stays under the 300 LoC ceiling.

import type { CatalogTrackT } from 'spotoei-protocol';
import { mapTrack } from './mappers';
import { pickObjectKey, toArray } from './shape';
import { ApiError, type Transport } from './transport';

function isForbiddenError(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === 'FORBIDDEN' || error.status === 403;
  const msg = error instanceof Error ? error.message : String(error);
  return /FORBIDDEN/.test(msg) || /\b403\b/.test(msg);
}

// Resolves seed tracks to their artists, then fans out to
// /artists/{id}/top-tracks.
export async function getTopTracksFallback(
  transport: Transport,
  seedTracks: string[],
  seedArtists: string[],
  limit: number,
): Promise<CatalogTrackT[]> {
  const artistIds: string[] = [];
  const seenArtists = new Set<string>();
  const pushArtist = (id: string): void => {
    if (!id || seenArtists.has(id) || artistIds.length >= 5) return;
    seenArtists.add(id);
    artistIds.push(id);
  };
  for (const id of seedArtists) pushArtist(id);
  // Resolve seed tracks to artists (best effort, capped to bound requests).
  for (const trackId of seedTracks) {
    if (artistIds.length >= 5) break;
    try {
      const json = await transport.request(`/tracks/${encodeURIComponent(trackId)}`);
      const rawArtists =
        json !== null && typeof json === 'object'
          ? (json as { artists?: unknown }).artists
          : undefined;
      const list = toArray(rawArtists);
      for (const entry of list) {
        if (entry !== null && typeof entry === 'object') {
          const id = (entry as { id?: unknown }).id;
          if (typeof id === 'string') pushArtist(id);
        }
        if (artistIds.length >= 5) break;
      }
    } catch {
      // Ignore per-track lookup failures; other seeds may still resolve.
    }
  }
  if (artistIds.length === 0) return [];

  const excluded = new Set(seedTracks);
  const tracks: CatalogTrackT[] = [];
  const seenTracks = new Set<string>();
  for (const artistId of artistIds) {
    if (tracks.length >= limit) break;
    try {
      const json = await transport.request(
        `/artists/${encodeURIComponent(artistId)}/top-tracks?market=from_token`,
      );
      for (const item of toArray(pickObjectKey(json, 'tracks'))) {
        const mapped = mapTrack(item);
        if (!mapped || seenTracks.has(mapped.id) || excluded.has(mapped.id)) continue;
        seenTracks.add(mapped.id);
        tracks.push(mapped);
        if (tracks.length >= limit) break;
      }
    } catch (error) {
      // A 403 here is an app-wide restriction (dev apps without Extended
      // Quota): every artist would fail identically, so stop fanning out.
      // Other failures stay local; remaining artists may still deliver.
      if (isForbiddenError(error)) break;
    }
  }
  return tracks;
}
