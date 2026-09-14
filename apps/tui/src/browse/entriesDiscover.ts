// Static discover and full-catalog browse entries.

import type { BrowseEntryT } from 'spotoei-protocol';

export const DISCOVER_ENTRIES: BrowseEntryT[] = [
  {
    id: 'top_artists',
    label: 'Top Artists',
    description: 'Artists you listen to most',
    enabled: true,
    source: { kind: 'top_artists' },
  },
  {
    id: 'new_releases',
    label: 'New Releases',
    description: 'Newly released tracks and albums',
    enabled: true,
    source: { kind: 'search', query: 'tag:new', types: ['album', 'track'] },
  },
  {
    id: 'search_all',
    label: 'Search Catalog',
    description: 'Explore all music on Spotify',
    enabled: true,
    source: { kind: 'search', query: '*', types: ['track', 'album', 'artist', 'playlist'] },
  },
];

export const NEW_RELEASES_ENTRIES: BrowseEntryT[] = [
  {
    id: 'new_albums',
    label: 'New Albums',
    description: 'Fresh full-length albums',
    enabled: true,
    source: { kind: 'search', query: 'tag:new album', types: ['album'] },
  },
  {
    id: 'new_singles',
    label: 'New Singles',
    description: 'Fresh singles and EPs',
    enabled: true,
    source: { kind: 'search', query: 'tag:new single', types: ['track', 'album'] },
  },
];

export const SEARCH_ALL_ENTRIES: BrowseEntryT[] = [
  {
    id: 'search_tracks',
    label: 'Tracks',
    description: 'Search tracks by keyword',
    enabled: true,
    source: { kind: 'search', query: '', types: ['track'] },
  },
  {
    id: 'search_albums',
    label: 'Albums',
    description: 'Search albums by title',
    enabled: true,
    source: { kind: 'search', query: '', types: ['album'] },
  },
  {
    id: 'search_artists',
    label: 'Artists',
    description: 'Search artists by name',
    enabled: true,
    source: { kind: 'search', query: '', types: ['artist'] },
  },
  {
    id: 'search_playlists',
    label: 'Playlists',
    description: 'Search public playlists',
    enabled: true,
    source: { kind: 'search', query: '', types: ['playlist'] },
  },
];
