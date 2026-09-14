// Static genre and decade browse entries.

import type { BrowseEntryT } from 'spotoei-protocol';

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
  {
    id: 'rnb',
    label: 'R&B',
    description: 'Smooth rhythm and blues',
    enabled: true,
    source: { kind: 'search', query: 'r&b soul', types: ['playlist', 'track'] },
  },
  {
    id: 'metal',
    label: 'Metal',
    description: 'Heavy riffs and distortion',
    enabled: true,
    source: { kind: 'search', query: 'heavy metal', types: ['playlist', 'album'] },
  },
  {
    id: 'country',
    label: 'Country',
    description: 'Americana and modern country',
    enabled: true,
    source: { kind: 'search', query: 'country americana', types: ['playlist', 'track'] },
  },
  {
    id: 'electronic',
    label: 'Electronic',
    description: 'Beats, house and techno',
    enabled: true,
    source: { kind: 'search', query: 'electronic edm', types: ['playlist', 'track'] },
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
