import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { LibraryManager } from '../src/library';
import { WebApiClient } from '../src/webApi';
import { Cache } from '../src/cache';
import type { LibraryPageResponseT } from 'spotoei-protocol';

describe('LibraryManager', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(':memory:');
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
      async saveItem(): Promise<boolean> {
        return true;
      },
      async removeItem(): Promise<boolean> {
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
});
