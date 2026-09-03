// Browse result labeling and fetch guards. Search-backed pages state
// "Catalog search results"; disabled entries never issue API requests.

import type { BrowseEntryT } from 'spotoei-protocol';

export function browseResultsLabel(entry: BrowseEntryT): string {
  if (entry.source.kind === 'search') return 'Catalog search results';
  if (entry.source.kind === 'playlist') return 'Playlist';
  if (entry.source.kind === 'library') return 'Library playlists';
  if (entry.source.kind === 'top_artists') return 'Top artists';
  return 'Queue';
}

export function shouldFetchBrowseEntry(entry: BrowseEntryT): boolean {
  if (!entry.enabled) return false;
  if (entry.source.kind === 'playlist') return entry.source.playlistUri.length > 0;
  return true;
}
