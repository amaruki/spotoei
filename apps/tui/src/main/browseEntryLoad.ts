// @ts-nocheck
import type { BrowseEntryT, CatalogTrackT } from 'spotoei-protocol';
import { shouldFetchBrowseEntry } from '../browse/results';
import type { Ui } from '../ui/types';
import {
  clearDynamicEntries,
  getBrowseTracks,
  getBrowseTracksKey,
  isBrowseTracksMode,
  setBrowseMode,
  setBrowseTracks,
  setBrowseTracksKey,
} from './browseLoadState';
import {
  type BrowseEntityClient,
  type BrowseSearchClient,
  browseResultLabelFor,
  findBrowseEntry,
  isInlineBrowseEntry,
  rankPlaylistHits,
} from './browseNav';

export async function ensureBrowseEntry(
  ui: Ui,
  path: { category?: string; entry?: string },
  clients: { entityManager: BrowseEntityClient; searchClient: BrowseSearchClient },
): Promise<boolean> {
  if (!path.category || !path.entry) return false;
  const key = `${path.category}:${path.entry}`;
  if (isBrowseTracksMode() && getBrowseTracksKey() === key && getBrowseTracks().length > 0) {
    ui.setBrowseTracks(getBrowseTracks());
    return true;
  }
  clearDynamicEntries();
  const entry = findBrowseEntry(path);
  if (!entry) {
    ui.setStatus(`Unknown browse entry: ${path.entry}`, true);
    return false;
  }
  if (!shouldFetchBrowseEntry(entry)) {
    ui.setStatus(`${entry.label} is unavailable — configure sources in Settings, then retry`, true);
    return false;
  }
  try {
    if (await handleBrowseEntryInline(entry, ui, clients.entityManager)) {
      // Cache the key only when tracks mode was actually entered:
      // navigation/redirect handlers also return true but leave no rows.
      if (isBrowseTracksMode()) setBrowseTracksKey(key);
      return true;
    }
    if (
      await handleSearchBrowseEntryInline(entry, clients.searchClient, ui, clients.entityManager)
    ) {
      if (isBrowseTracksMode()) setBrowseTracksKey(key);
      return true;
    }
  } catch (err) {
    ui.setStatus(
      `Browse load failed for ${entry.label}: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
    return false;
  }
  return false;
}
export async function ensureCategoryPlaylistEntry(
  ui: Ui,
  playlistId: string,
  clients: { entityManager: { loadPlaylist: (id: string) => Promise<unknown> } },
): Promise<boolean> {
  try {
    const view = (await clients.entityManager.loadPlaylist(playlistId)) as {
      playlist?: { name?: string };
    } | null;
    void view;
    return true;
  } catch {
    return false;
  }
}
export async function handleBrowseEntryInline(
  entry: BrowseEntryT,
  ui: Ui,
  entityManager: BrowseEntityClient,
): Promise<boolean> {
  if (!isInlineBrowseEntry(entry)) return false;
  if (entry.source.kind === 'new_releases') {
    const albums = (await entityManager.loadNewReleases(entry.source.limit ?? 20)) as Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ name: string }>;
    }>;
    const tracks = albums
      .slice(0, 20)
      .map((a) => ({ id: a.id, uri: a.uri, name: a.name, artists: a.artists })) as CatalogTrackT[];
    setBrowseTracks(tracks);
    setBrowseMode('tracks');
    ui.setBrowseTracks(tracks);
    ui.setStatus(`New releases: ${albums.length} albums`, true);
    return true;
  }
  if (entry.source.kind === 'recommendations') {
    const tracks = (await entityManager.loadRecommendations({
      limit: entry.source.limit ?? 20,
      seedGenres: (entry.source as { seedGenres?: string[] }).seedGenres,
      seedArtists: (entry.source as { seedArtists?: string[] }).seedArtists,
      seedTracks: (entry.source as { seedTracks?: string[] }).seedTracks,
    })) as CatalogTrackT[];
    setBrowseTracks(tracks);
    setBrowseMode('tracks');
    ui.setBrowseTracks(tracks);
    ui.setStatus(`Recommendations: ${tracks.length} tracks`, true);
    return true;
  }
  return false;
}
export async function handleSearchBrowseEntryInline(
  entry: BrowseEntryT,
  searchClient: BrowseSearchClient,
  ui: Ui,
  entityManager?: BrowseEntityClient,
): Promise<boolean> {
  if (entry.source.kind !== 'search') return false;
  const query = entry.source.query.trim();
  if (!query || query === '*') {
    setBrowseMode('entries');
    setBrowseTracks([]);
    setBrowseTracksKey('');
    ui.setRoute({ kind: 'search' });
    ui.setStatus('Type a keyword in Search — pick a result to play it', true);
    return true;
  }
  const res = await searchClient.search(
    query,
    (entry.source.types ?? ['track']) as Array<'track' | 'album' | 'artist' | 'playlist'>,
  );
  const tracks = res.hits
    .filter((h): h is { type: 'track'; track: CatalogTrackT } => h.type === 'track')
    .map((h) => h.track);
  if (tracks.length > 0) {
    setBrowseTracks(tracks);
    setBrowseMode('tracks');
    ui.setBrowseTracks(tracks);
    ui.setStatus(`${browseResultLabelFor(entry)} — ${tracks.length} tracks`, true);
    return true;
  }
  // No direct track hits: walk the entry's own type order. Playlist and
  // album matches open their full entity page (header + all tracks, like
  // spotify-player's browse → context flow) instead of rendering a flat,
  // context-free track list. Each candidate is probed with the same page
  // parameters the entity page uses, so dead playlists are skipped and the
  // entity page itself renders from cache.
  for (const kind of entry.source.types ?? []) {
    if (kind === 'playlist') {
      const candidates = rankPlaylistHits(
        res.hits.filter(
          (h): h is { type: 'playlist'; playlist: { id: string; uri: string; name: string } } =>
            h.type === 'playlist',
        ),
        query,
      ).slice(0, 3);
      for (const hit of candidates) {
        const pid = (hit.playlist.uri.split(':').pop() ?? '').trim() || hit.playlist.id;
        if (!pid) continue;
        if (entityManager?.loadPlaylistTracks) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- probe candidates until one resolves
            const page = await entityManager.loadPlaylistTracks(pid, 0, 100);
            if ((page.items as unknown[]).length === 0) continue;
          } catch {
            continue;
          }
        }
        setBrowseMode('entries');
        setBrowseTracks([]);
        setBrowseTracksKey('');
        ui.setRoute({ kind: 'playlist', id: pid });
        ui.setStatus(`${browseResultLabelFor(entry)} — “${hit.playlist.name}”`, true);
        return true;
      }
    }
    if (kind === 'album') {
      const candidates = res.hits
        .filter(
          (h): h is { type: 'album'; album: { id: string; uri: string; name: string } } =>
            h.type === 'album',
        )
        .slice(0, 3);
      for (const hit of candidates) {
        const aid = (hit.album.uri.split(':').pop() ?? '').trim() || hit.album.id;
        if (!aid) continue;
        if (entityManager?.loadAlbumTracks) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- probe candidates until one resolves
            const page = await entityManager.loadAlbumTracks(aid, 0, 20);
            if ((page.items as unknown[]).length === 0) continue;
          } catch {
            continue;
          }
        }
        setBrowseMode('entries');
        setBrowseTracks([]);
        setBrowseTracksKey('');
        ui.setRoute({ kind: 'album', id: aid });
        ui.setStatus(`${browseResultLabelFor(entry)} — “${hit.album.name}”`, true);
        return true;
      }
    }
  }
  setBrowseTracks([]);
  setBrowseMode('tracks');
  ui.setBrowseTracks([]);
  ui.setStatus(`No tracks found for ${entry.label}`, true);
  return true;
}
