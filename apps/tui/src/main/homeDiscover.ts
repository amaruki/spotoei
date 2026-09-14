import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import { diagnostic, reportFailure } from '../diagnostics';

function isCatalogRestriction(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Quota exhaustion keeps its dedicated reporting path (quota banner),
  // never the silent restriction downgrade.
  if (/QUOTA/i.test(msg)) return false;
  return /FORBIDDEN/.test(msg) || /\b403\b/.test(msg) || /HTTP_404/.test(msg);
}

// Other tracks by the seed artists, via artist-albums → album-tracks.
// Uses only non-deprecated endpoints; seed IDs are excluded so the result
// never duplicates the Recently Played / Top Tracks panels.
async function moreFromSeedArtists(
  manager: EntityManager,
  seeds: CatalogTrackT[],
  count: number,
): Promise<CatalogTrackT[]> {
  const excluded = new Set(seeds.map((track) => track.id));
  const artistIds: string[] = [];
  const seenArtists = new Set<string>();
  for (const track of seeds) {
    for (const artist of track.artists ?? []) {
      const id = typeof artist === 'string' ? '' : artist?.id;
      if (!id || id === 'unknown' || seenArtists.has(id)) continue;
      seenArtists.add(id);
      artistIds.push(id);
      if (artistIds.length >= 3) break;
    }
    if (artistIds.length >= 3) break;
  }
  const out: CatalogTrackT[] = [];
  const seenTracks = new Set<string>();
  for (const artistId of artistIds) {
    if (out.length >= count) break;
    let albums: CatalogAlbumT[] = [];
    try {
      // oxlint-disable-next-line no-await-in-loop -- stop at count to bound requests
      albums = (await manager.loadArtistAlbums(artistId, 'album', 0, 10)).items;
    } catch {
      continue;
    }
    for (const album of albums.slice(0, 2)) {
      if (out.length >= count) break;
      let items: CatalogTrackT[] = [];
      try {
        // oxlint-disable-next-line no-await-in-loop -- stop at count to bound requests
        items = (await manager.loadAlbumTracks(album.id, 0, 5)).items;
      } catch {
        continue;
      }
      for (const track of items) {
        if (excluded.has(track.id) || seenTracks.has(track.id)) continue;
        seenTracks.add(track.id);
        out.push(track);
        if (out.length >= count) break;
      }
    }
  }
  return out;
}

export async function discover(
  manager: EntityManager,
  seeds: CatalogTrackT[],
): Promise<{ tracks: CatalogTrackT[]; label: string }> {
  try {
    const albums = await manager.loadNewReleases(6);
    const pages = await Promise.all(
      albums.slice(0, 4).map((album) => manager.loadAlbumTracks(album.id, 0, 2)),
    );
    const tracks = pages.flatMap((page) => page.items).slice(0, 6);
    if (tracks.length) return { tracks, label: 'Discover · New releases' };
  } catch (error) {
    // Browse endpoints are restricted for dev apps without Extended Quota
    // (403/404) — expected, not actionable. Log at diagnostic level and fall
    // through to recommendations/history instead of error-reporting every
    // home load.
    if (isCatalogRestriction(error)) {
      diagnostic('application', 'home.discover.releases.unavailable', {});
    } else {
      reportFailure('application', 'home.discover.releases', error);
    }
  }
  if (seeds.length) {
    const seedArtistIds = [
      ...new Set(
        seeds.flatMap((track) =>
          (track.artists ?? [])
            .map((artist) => (typeof artist === 'string' ? '' : artist?.id))
            .filter((id): id is string => !!id && id !== 'unknown'),
        ),
      ),
    ].slice(0, 5);
    try {
      const tracks = await manager.loadRecommendations({
        limit: 8,
        seedTracks: seeds.slice(0, 5).map((track) => track.id),
        seedArtists: seedArtistIds,
      });
      if (tracks.length) return { tracks: tracks.slice(0, 6), label: 'Discover · Recommended' };
    } catch (error) {
      if (isCatalogRestriction(error)) {
        diagnostic('application', 'home.discover.recommendations.unavailable', {});
      } else {
        reportFailure('application', 'home.discover.recommendations', error);
      }
    }
    // Both Spotify discovery endpoints are restricted for dev apps, so build
    // Discover from working endpoints: other tracks by the seed artists.
    // Seed track IDs are excluded so this never mirrors Recently Played.
    try {
      const tracks = await moreFromSeedArtists(manager, seeds, 6);
      if (tracks.length) return { tracks, label: 'Discover · More from your artists' };
    } catch (error) {
      if (isCatalogRestriction(error)) {
        diagnostic('application', 'home.discover.artists.unavailable', {});
      } else {
        reportFailure('application', 'home.discover.artists', error);
      }
    }
  }
  return {
    tracks: seeds.slice(0, 6),
    label: seeds.length
      ? 'Discover · From your listening history'
      : 'Discover · No preview available',
  };
}
