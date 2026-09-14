// Static charts and editorial fallback browse entries.

import type { BrowseEntryT } from 'spotoei-protocol';

export const CHARTS_FALLBACK_ENTRIES: BrowseEntryT[] = [
  {
    id: 'charts_top_hits',
    label: 'Top Hits',
    description: 'Current popular hits across genres',
    enabled: true,
    source: { kind: 'search', query: 'top hits', types: ['playlist', 'track'] },
  },
  {
    id: 'charts_viral',
    label: 'Viral Hits',
    description: 'Trending tracks on the rise',
    enabled: true,
    source: { kind: 'search', query: 'viral hits', types: ['playlist', 'track'] },
  },
  {
    id: 'charts_new',
    label: 'New & Fresh',
    description: 'Freshly released tracks',
    enabled: true,
    source: { kind: 'search', query: 'tag:new', types: ['playlist', 'album', 'track'] },
  },
  {
    id: 'charts_global',
    label: 'Global Hits',
    description: 'Top international songs',
    enabled: true,
    source: { kind: 'search', query: 'global hits', types: ['playlist', 'track'] },
  },
];

export const EDITORIAL_FALLBACK_ENTRIES: BrowseEntryT[] = [
  {
    id: 'editorial_albums',
    label: 'Top Albums',
    description: 'Curated complete records',
    enabled: true,
    source: { kind: 'search', query: 'top albums', types: ['album', 'playlist'] },
  },
  {
    id: 'editorial_songs',
    label: 'Best Songs',
    description: 'Critically acclaimed tracks',
    enabled: true,
    source: { kind: 'search', query: 'best songs', types: ['playlist', 'track'] },
  },
  {
    id: 'editorial_classics',
    label: 'Classic Hits',
    description: 'Timeless master recordings',
    enabled: true,
    source: { kind: 'search', query: 'classic hits', types: ['playlist', 'album'] },
  },
];
