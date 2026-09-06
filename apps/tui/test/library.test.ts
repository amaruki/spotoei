import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { LibraryManager } from '../src/library';
import { WebApiClient } from '../src/webApi';
import { Cache } from '../src/cache';
import type { LibraryPageResponseT } from 'spotoei-protocol';

describe('LibraryManager', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache({ filename: ':memory:' });
  });

  afterEach(() => {
    cache.close();
  });

  test('returns fresh page from WebApiClient and caches it', async () => {
    let callCount = 0;
    const fakeWebApiClient = {
      async getLibraryPage(
        collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
        offset = 0,
        limit = 20,
      ): Promise<LibraryPageResponseT> {
        callCount++;
        return {
          collection,
          items: [
            {
              id: 't1',
              uri: 'spotify:track:t1',
              name: 'Track 1',
              artists: [{ id: 'a1', name: 'Artist 1', uri: 'spotify:artist:a1' }],
              albumId: 'al1',
              albumName: 'Album 1',
              durationMs: 120000,
            },
          ],
          total: 1,
          offset,
          limit,
          hasMore: false,
        };
      },
    } as unknown as WebApiClient;

    const manager = new LibraryManager({
      webApi: fakeWebApiClient,
      cache,
      accountId: 'test-user',
    });

    const p1 = await manager.getPage('saved_tracks', 0, 20);
    expect(p1.items.length).toBe(1);
    expect(callCount).toBe(1);

    // Second call should hit the cache and not invoke WebApiClient
    const p2 = await manager.getPage('saved_tracks', 0, 20);
    expect(p2.items.length).toBe(1);
    expect(callCount).toBe(1);

    // Force refresh bypasses cache
    const p3 = await manager.getPage('saved_tracks', 0, 20, true);
    expect(p3.items.length).toBe(1);
    expect(callCount).toBe(2);
  });

  test('does not cache error responses', async () => {
    let callCount = 0;
    const fakeWebApiClient = {
      async getLibraryPage(
        collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
        offset = 0,
        limit = 20,
      ): Promise<LibraryPageResponseT> {
        callCount++;
        return {
          collection,
          items: [],
          total: 0,
          offset,
          limit,
          hasMore: false,
          error: {
            code: 'NETWORK_ERROR',
            message: 'failed',
            retryable: true,
          },
        };
      },
    } as unknown as WebApiClient;

    const manager = new LibraryManager({
      webApi: fakeWebApiClient,
      cache,
      accountId: 'test-user',
    });

    const p1 = await manager.getPage('saved_tracks', 0, 20);
    expect(p1.error).toBeDefined();
    expect(callCount).toBe(1);

    // Second call should hit network again because error wasn't cached
    const p2 = await manager.getPage('saved_tracks', 0, 20);
    expect(p2.error).toBeDefined();
    expect(callCount).toBe(2);
  });

  test('invalidates cache on save/remove mutations', async () => {
    let callCount = 0;
    const fakeWebApiClient = {
      async getLibraryPage(
        collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
        offset = 0,
        limit = 20,
      ): Promise<LibraryPageResponseT> {
        callCount++;
        return {
          collection,
          items: [],
          total: 0,
          offset,
          limit,
          hasMore: false,
        };
      },
      async saveUris(): Promise<boolean> {
        return true;
      },
      async removeUris(): Promise<boolean> {
        return true;
      },
    } as unknown as WebApiClient;

    const manager = new LibraryManager({
      webApi: fakeWebApiClient,
      cache,
      accountId: 'test-user',
    });

    await manager.getPage('saved_tracks', 0, 20);
    expect(callCount).toBe(1);

    // Should hit cache
    await manager.getPage('saved_tracks', 0, 20);
    expect(callCount).toBe(1);

    // Save mutation invalidates cache
    await manager.save('track', 't1');

    // Next getPage should hit network again
    await manager.getPage('saved_tracks', 0, 20);
    expect(callCount).toBe(2);
  });

  test('tracks offset, total, and hasMore per collection and paginates past 50 items', async () => {
    const totalItems = 120;
    const fakeWebApiClient = {
      async getLibraryPage(
        collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
        offset = 0,
        limit = 20,
        cursor?: string,
      ): Promise<LibraryPageResponseT> {
        const remaining = Math.max(0, totalItems - offset);
        const count = Math.min(limit, remaining);
        const items = Array.from({ length: count }, (_, i) => ({
          id: `track-${offset + i}`,
          uri: `spotify:track:${offset + i}`,
          name: `Track ${offset + i}`,
          durationMs: 200_000,
          artists: [],
        }));
        const nextOffset = offset + count;
        return {
          collection,
          items,
          total: totalItems,
          offset,
          limit,
          hasMore: nextOffset < totalItems,
          nextOffset,
          nextCursor: cursor ? `c-${nextOffset}` : undefined,
        };
      },
    } as unknown as WebApiClient;

    const manager = new LibraryManager({
      webApi: fakeWebApiClient,
      cache,
      accountId: 'test-user',
    });

    // Page 1: 0..50
    const page1 = await manager.getPage('saved_tracks', 0, 50);
    expect(page1.items.length).toBe(50);
    expect(page1.hasMore).toBe(true);
    expect(manager.getOffset('saved_tracks')).toBe(0);
    expect(manager.getTotal('saved_tracks')).toBe(120);
    expect(manager.hasMore('saved_tracks')).toBe(true);
    expect(manager.getCollectionMeta('saved_tracks')).toEqual({
      offset: 0,
      total: 120,
      hasMore: true,
      nextOffset: 50,
      cursor: undefined,
    });

    // Page 2: 50..100
    const page2 = await manager.getPage('saved_tracks', 50, 50);
    expect(page2.items.length).toBe(50);
    expect(page2.hasMore).toBe(true);
    expect(manager.getOffset('saved_tracks')).toBe(50);
    expect(manager.getTotal('saved_tracks')).toBe(120);
    expect(manager.hasMore('saved_tracks')).toBe(true);
    expect(manager.getCollectionMeta('saved_tracks').nextOffset).toBe(100);

    // Page 3: 100..120 (reaches end)
    const page3 = await manager.getPage('saved_tracks', 100, 50);
    expect(page3.items.length).toBe(20);
    expect(page3.hasMore).toBe(false);
    expect(manager.getOffset('saved_tracks')).toBe(100);
    expect(manager.hasMore('saved_tracks')).toBe(false);
    expect(manager.getCollectionMeta('saved_tracks').nextOffset).toBe(120);

    // Invalidate resets collection meta
    manager.invalidate('saved_tracks');
    expect(manager.getCollectionMeta('saved_tracks')).toEqual({
      offset: 0,
      total: 0,
      hasMore: true,
      cursor: undefined,
    });
  });

  test('supports cursor-based pagination for followed_artists', async () => {
    const fakeWebApiClient = {
      async getLibraryPage(
        collection: 'saved_tracks' | 'saved_albums' | 'followed_artists' | 'playlists',
        offset = 0,
        limit = 20,
        cursor?: string,
      ): Promise<LibraryPageResponseT> {
        const isFirst = !cursor && offset === 0;
        return {
          collection,
          items: [
            {
              id: isFirst ? 'artist-1' : 'artist-2',
              uri: isFirst ? 'spotify:artist:1' : 'spotify:artist:2',
              name: isFirst ? 'Artist 1' : 'Artist 2',
            },
          ],
          total: 2,
          offset,
          limit,
          hasMore: isFirst,
          nextOffset: offset + 1,
          nextCursor: isFirst ? 'cursor-art-1' : undefined,
        };
      },
    } as unknown as WebApiClient;

    const manager = new LibraryManager({
      webApi: fakeWebApiClient,
      cache,
      accountId: 'test-user',
    });

    const p1 = await manager.getPage('followed_artists', 0, 1);
    expect(p1.items[0]?.name).toBe('Artist 1');
    expect(p1.hasMore).toBe(true);
    expect(manager.getCursor('followed_artists')).toBe('cursor-art-1');

    const p2 = await manager.getPage('followed_artists', 1, 1, false, 'cursor-art-1');
    expect(p2.items[0]?.name).toBe('Artist 2');
    expect(p2.hasMore).toBe(false);
    expect(manager.getCursor('followed_artists')).toBeUndefined();
  });
});
