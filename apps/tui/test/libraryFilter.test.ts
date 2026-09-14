import { describe, expect, test, beforeEach } from 'bun:test';
import { Cache } from '../src/cache';
import {
  filterLibraryLocal as filterSearchLocal,
  createSearchClient,
  isFuzzyMatch,
  filterItemsInMemory,
} from '../src/search';
import { filterLibraryLocal as filterMainLocal, createLibraryActions } from '../src/main/library';
import type { AppContext } from '../src/main/types';
import type { LibraryItemT } from '../src/ui';
import type { WebApiClient } from '../src/webApi';

describe('Offline SQLite Fuzzy/Substring Filter', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  const sampleTracks: LibraryItemT[] = [
    {
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Bohemian Rhapsody',
      artists: [{ id: 'a1', name: 'Queen' }],
      albumName: 'A Night at the Opera',
      durationMs: 354000,
    },
    {
      id: 't2',
      uri: 'spotify:track:t2',
      name: 'Radio Ga Ga',
      artists: [{ id: 'a1', name: 'Queen' }],
      albumName: 'The Works',
      durationMs: 348000,
    },
    {
      id: 't3',
      uri: 'spotify:track:t3',
      name: 'Creep',
      artists: [{ id: 'a2', name: 'Radiohead' }],
      albumName: 'Pablo Honey',
      durationMs: 238000,
    },
    {
      id: 't4',
      uri: 'spotify:track:t4',
      name: 'Karma Police',
      artists: [{ id: 'a2', name: 'Radiohead' }],
      albumName: 'OK Computer',
      durationMs: 261000,
    },
    {
      id: 't5',
      uri: 'spotify:track:t5',
      name: 'Stairway to Heaven',
      artists: [{ id: 'a3', name: 'Led Zeppelin' }],
      albumName: 'Led Zeppelin IV',
      durationMs: 482000,
    },
  ];

  test('isFuzzyMatch performs sequence matching correctly', () => {
    expect(isFuzzyMatch('Bohemian Rhapsody', 'bhm')).toBe(true);
    expect(isFuzzyMatch('Radiohead', 'rh')).toBe(true);
    expect(isFuzzyMatch('Led Zeppelin', 'lz')).toBe(true);
    expect(isFuzzyMatch('Creep', 'crp')).toBe(true);
    expect(isFuzzyMatch('Creep', 'xyz')).toBe(false);
  });

  test('filterItemsInMemory performs substring and fuzzy search with ranking', () => {
    // Substring match on title
    const res1 = filterItemsInMemory('bohem', sampleTracks);
    expect(res1.length).toBe(1);
    expect(res1[0]?.name).toBe('Bohemian Rhapsody');

    // Substring match on artist
    const res2 = filterItemsInMemory('queen', sampleTracks);
    expect(res2.length).toBe(2);
    expect(new Set(res2.map((t) => t.name))).toEqual(new Set(['Bohemian Rhapsody', 'Radio Ga Ga']));

    // Multi-token match across name and artist
    const res3 = filterItemsInMemory('radio creep', sampleTracks);
    expect(res3.length).toBe(1);
    expect(res3[0]?.name).toBe('Creep');

    // Fuzzy match
    const res4 = filterItemsInMemory('bhm', sampleTracks);
    expect(res4.length).toBe(1);
    expect(res4[0]?.name).toBe('Bohemian Rhapsody');

    // Fuzzy match on artist
    const res5 = filterItemsInMemory('lz', sampleTracks);
    expect(res5.length).toBe(1);
    expect(res5[0]?.name).toBe('Stairway to Heaven');
  });

  test('filterLibraryLocal in search.ts filters in-memory items and formats SearchHits', () => {
    const res = filterSearchLocal('radiohead', sampleTracks);
    expect(res.length).toBe(2);
    expect(res.query).toBe('radiohead');
    expect(res.hits.length).toBe(2);
    expect(res.hits[0]?.type).toBe('track');
    expect(new Set(res.map((t) => (t as LibraryItemT).name))).toEqual(
      new Set(['Creep', 'Karma Police']),
    );
  });

  test('filterLibraryLocal in search.ts filters via SQLite cache under 5ms without network calls', () => {
    cache.indexLibraryItems('user1', 'saved_tracks', sampleTracks);

    const t0 = performance.now();
    const res = filterSearchLocal('queen', cache, 'user1');
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(5);
    expect(res.length).toBe(2);
    expect(new Set(res.map((t) => (t as LibraryItemT).name))).toEqual(
      new Set(['Bohemian Rhapsody', 'Radio Ga Ga']),
    );
    expect(res.hits.length).toBe(2);
  });

  test('SearchClient.filterLibraryLocal searches cached library', () => {
    cache.indexLibraryItems('user1', 'saved_tracks', sampleTracks);

    const mockWebApi = {
      search: async () => ({ query: '', hits: [] }),
    } as unknown as WebApiClient;

    const client = createSearchClient({
      webApi: mockWebApi,
      cache,
      accountId: 'user1',
    });

    const res = client.filterLibraryLocal('stairway');
    expect(res.length).toBe(1);
    expect((res[0] as LibraryItemT).name).toBe('Stairway to Heaven');
    expect(res.hits[0]?.type).toBe('track');
    client.close();
  });

  test('filterLibraryLocal in main/library.ts filters state items and updates UI', () => {
    const uiMessages: string[] = [];
    let renderedItems: LibraryItemT[] = [];

    const mockUi = {
      setLibraryLoading() {},
      setStatus(msg: string) {
        uiMessages.push(msg);
      },
      setLibraryItems(items: LibraryItemT[]) {
        renderedItems = items;
      },
    };

    cache.indexLibraryItems('user1', 'saved_tracks', sampleTracks);

    const state = {
      libraryItems: [...sampleTracks],
      librarySection: 'saved_tracks' as const,
      playback: null,
      currentInfo: { auth: { accountId: 'user1' } },
    };

    const ctx = {
      clients: { cache },
      state,
      getUi: () => mockUi,
    } as unknown as AppContext;

    const actions = createLibraryActions(ctx);

    // Initial filter for 'bohemian'
    const filtered = actions.filterLibraryLocal('bohemian');
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.name).toBe('Bohemian Rhapsody');
    expect(renderedItems.length).toBe(1);
    expect(renderedItems[0]?.name).toBe('Bohemian Rhapsody');

    // Filter with fuzzy matching 'crp' -> Creep
    const fuzzyRes = actions.filterLibraryLocal('crp');
    expect(fuzzyRes.length).toBe(1);
    expect(fuzzyRes[0]?.name).toBe('Creep');

    // Clearing query restores all items
    const restored = actions.filterLibraryLocal('');
    expect(restored.length).toBe(5);
    expect(renderedItems.length).toBe(5);
  });

  test('standalone filterLibraryLocal in main/library.ts filters items directly', () => {
    const res = filterMainLocal('karma', sampleTracks);
    expect(res.length).toBe(1);
    expect(res[0]?.name).toBe('Karma Police');
  });

  test('cache search works across tracks, albums, and playlists with collection filter', () => {
    cache.indexLibraryItems('user1', 'saved_tracks', [
      { id: 't1', name: 'Wish You Were Here', artists: [{ name: 'Pink Floyd' }] },
    ]);
    cache.indexLibraryItems('user1', 'saved_albums', [
      { id: 'al1', name: 'Wish You Were Here', artists: [{ name: 'Pink Floyd' }] },
    ]);
    cache.indexLibraryItems('user1', 'playlists', [{ id: 'p1', name: 'Pink Floyd Greatest' }]);

    // Search across all collections
    const all = cache.searchLibrary<{ id: string; name: string }>('user1', 'floyd');
    expect(all.length).toBe(3);

    // Filter only saved_albums
    const albums = cache.searchLibrary<{ id: string; name: string }>(
      'user1',
      'floyd',
      'saved_albums',
    );
    expect(albums.length).toBe(1);
    expect(albums[0]?.id).toBe('al1');

    // Filter only playlists
    const playlists = cache.searchLibrary<{ id: string; name: string }>(
      'user1',
      'floyd',
      'playlists',
    );
    expect(playlists.length).toBe(1);
    expect(playlists[0]?.id).toBe('p1');
  });
});
