// Static browse category entries split out of `browse.ts` to keep
// the registry builder under the 300 LoC ceiling.
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

export const MOODS_ENTRIES: BrowseEntryT[] = [
  {
    id: 'chill',
    label: 'Chill',
    description: 'Relaxed and calm vibes',
    enabled: true,
    source: { kind: 'search', query: 'chill', types: ['playlist', 'track'] },
  },
  {
    id: 'focus',
    label: 'Focus',
    description: 'Music for deep concentration',
    enabled: true,
    source: { kind: 'search', query: 'focus study', types: ['playlist'] },
  },
  {
    id: 'sleep',
    label: 'Sleep',
    description: 'Gentle ambient sounds for sleep',
    enabled: true,
    source: { kind: 'search', query: 'sleep ambient', types: ['playlist'] },
  },
  {
    id: 'happy',
    label: 'Happy & Upbeat',
    description: 'Feel-good mood boosters',
    enabled: true,
    source: { kind: 'search', query: 'happy feel good', types: ['playlist'] },
  },
  {
    id: 'party',
    label: 'Party',
    description: 'High energy dance and party',
    enabled: true,
    source: { kind: 'search', query: 'party dance', types: ['playlist'] },
  },
];

export const ACTIVITIES_ENTRIES: BrowseEntryT[] = [
  {
    id: 'workout',
    label: 'Workout',
    description: 'High-BPM energy music',
    enabled: true,
    source: { kind: 'search', query: 'workout gym', types: ['playlist'] },
  },
  {
    id: 'running',
    label: 'Running',
    description: 'Steady cadence beats',
    enabled: true,
    source: { kind: 'search', query: 'running tempo', types: ['playlist'] },
  },
  {
    id: 'gaming',
    label: 'Gaming',
    description: 'Electronic and synthwave gaming tracks',
    enabled: true,
    source: { kind: 'search', query: 'gaming electronic synthwave', types: ['playlist'] },
  },
  {
    id: 'study',
    label: 'Study',
    description: 'Lo-fi and classical study tunes',
    enabled: true,
    source: { kind: 'search', query: 'lofi study beats', types: ['playlist'] },
  },
  {
    id: 'cooking',
    label: 'Cooking & Dinner',
    description: 'Acoustic and jazz background tunes',
    enabled: true,
    source: { kind: 'search', query: 'dinner jazz acoustic', types: ['playlist'] },
  },
];

export const GENRES_ENTRIES: BrowseEntryT[] = [
  {
    id: 'pop',
    label: 'Pop',
    description: 'Current pop hits',
    enabled: true,
    source: { kind: 'search', query: 'genre:pop', types: ['playlist', 'track', 'album'] },
  },
  {
    id: 'rock',
    label: 'Rock',
    description: 'Rock and alternative',
    enabled: true,
    source: { kind: 'search', query: 'genre:rock', types: ['playlist', 'track', 'album'] },
  },
  {
    id: 'hiphop',
    label: 'Hip-Hop',
    description: 'Hip-hop and rap',
    enabled: true,
    source: { kind: 'search', query: 'genre:hip-hop', types: ['playlist', 'track', 'album'] },
  },
  {
    id: 'jazz',
    label: 'Jazz',
    description: 'Classic and modern jazz',
    enabled: true,
    source: { kind: 'search', query: 'genre:jazz', types: ['playlist', 'track', 'album'] },
  },
  {
    id: 'kpop',
    label: 'K-Pop',
    description: 'Korean pop sensations',
    enabled: true,
    source: { kind: 'search', query: 'genre:k-pop', types: ['playlist', 'track', 'album'] },
  },
  {
    id: 'electronic',
    label: 'Electronic',
    description: 'EDM, house, and techno',
    enabled: true,
    source: {
      kind: 'search',
      query: 'genre:electronic',
      types: ['playlist', 'track', 'album'],
    },
  },
];

export const DECADES_ENTRIES: BrowseEntryT[] = [
  {
    id: '2020s',
    label: '2020s',
    description: 'Hits of this decade',
    enabled: true,
    source: { kind: 'search', query: 'year:2020-2029', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '2010s',
    label: '2010s',
    description: '2010s nostalgia',
    enabled: true,
    source: { kind: 'search', query: 'year:2010-2019', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '2000s',
    label: '2000s',
    description: '2000s throwback',
    enabled: true,
    source: { kind: 'search', query: 'year:2000-2009', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '1990s',
    label: '1990s',
    description: '90s classics',
    enabled: true,
    source: { kind: 'search', query: 'year:1990-1999', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '1980s',
    label: '1980s',
    description: '80s synth and retro hits',
    enabled: true,
    source: { kind: 'search', query: 'year:1980-1989', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '1970s',
    label: '1970s',
    description: '70s rock, disco, funk',
    enabled: true,
    source: { kind: 'search', query: 'year:1970-1979', types: ['playlist', 'album', 'track'] },
  },
  {
    id: '1960s',
    label: '1960s',
    description: '60s soul, rock and roll',
    enabled: true,
    source: { kind: 'search', query: 'year:1960-1969', types: ['playlist', 'album', 'track'] },
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
