import { describe, expect, test } from 'bun:test';
import { LibraryEndpoints } from '../src/webApi/library';
import type { Transport } from '../src/webApi/transport';

describe('LibraryEndpoints pagination', () => {
  test('fetchSavedTracks passes offset and limit and computes nextOffset', async () => {
    let capturedUrl = '';
    const fakeTransport = {
      async request(url: string) {
        capturedUrl = url;
        return {
          items: [
            {
              track: {
                id: 't1',
                uri: 'spotify:track:t1',
                name: 'Song 1',
                duration_ms: 100000,
                artists: [],
              },
            },
            {
              track: {
                id: 't2',
                uri: 'spotify:track:t2',
                name: 'Song 2',
                duration_ms: 100000,
                artists: [],
              },
            },
          ],
          total: 100,
        };
      },
    } as unknown as Transport;

    const endpoints = new LibraryEndpoints(fakeTransport);
    const res = await endpoints.getLibraryPage('saved_tracks', 40, 20);

    expect(capturedUrl).toContain('/me/tracks?offset=40&limit=20');
    expect(res.items.length).toBe(2);
    expect(res.offset).toBe(40);
    expect(res.total).toBe(100);
    expect(res.hasMore).toBe(true);
    expect(res.nextOffset).toBe(42);
  });

  test('fetchSavedAlbums paginates properly', async () => {
    let capturedUrl = '';
    const fakeTransport = {
      async request(url: string) {
        capturedUrl = url;
        return {
          items: [{ album: { id: 'al1', uri: 'spotify:album:al1', name: 'Album 1', artists: [] } }],
          total: 1,
        };
      },
    } as unknown as Transport;

    const endpoints = new LibraryEndpoints(fakeTransport);
    const res = await endpoints.getLibraryPage('saved_albums', 0, 50);

    expect(capturedUrl).toContain('/me/albums?offset=0&limit=50');
    expect(res.items.length).toBe(1);
    expect(res.total).toBe(1);
    expect(res.hasMore).toBe(false);
    expect(res.nextOffset).toBe(1);
  });

  test('fetchUserPlaylists paginates properly past 50 items', async () => {
    let capturedUrl = '';
    const fakeTransport = {
      async request(url: string) {
        capturedUrl = url;
        return {
          items: [
            { id: 'p51', uri: 'spotify:playlist:p51', name: 'Playlist 51', tracks: { total: 10 } },
          ],
          total: 80,
        };
      },
    } as unknown as Transport;

    const endpoints = new LibraryEndpoints(fakeTransport);
    const res = await endpoints.getLibraryPage('playlists', 50, 50);

    expect(capturedUrl).toContain('/me/playlists?offset=50&limit=50');
    expect(res.items.length).toBe(1);
    expect(res.offset).toBe(50);
    expect(res.total).toBe(80);
    expect(res.hasMore).toBe(true);
    expect(res.nextOffset).toBe(51);
  });

  test('fetchFollowedArtists cursor and offset pagination', async () => {
    const urls: string[] = [];
    const fakeTransport = {
      async request(url: string) {
        urls.push(url);
        if (!url.includes('after=')) {
          // First page
          return {
            artists: {
              items: [{ id: 'a1', uri: 'spotify:artist:a1', name: 'Artist 1' }],
              total: 3,
              cursors: { after: 'cursor_1' },
            },
          };
        }
        if (url.includes('after=cursor_1')) {
          // Second page
          return {
            artists: {
              items: [{ id: 'a2', uri: 'spotify:artist:a2', name: 'Artist 2' }],
              total: 3,
              cursors: { after: 'cursor_2' },
            },
          };
        }
        // Third page
        return {
          artists: {
            items: [{ id: 'a3', uri: 'spotify:artist:a3', name: 'Artist 3' }],
            total: 3,
            cursors: null,
          },
        };
      },
    } as unknown as Transport;

    const endpoints = new LibraryEndpoints(fakeTransport);

    // Page 1: offset 0
    const p1 = await endpoints.getLibraryPage('followed_artists', 0, 1);
    expect(urls[0]).toBe('/me/following?type=artist&limit=1');
    expect(p1.items.length).toBe(1);
    expect(p1.items[0]?.name).toBe('Artist 1');
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).toBe('cursor_1');
    expect(p1.nextOffset).toBe(1);

    // Page 2: with offset 1 (uses remembered cursor)
    const p2 = await endpoints.getLibraryPage('followed_artists', 1, 1);
    expect(urls[1]).toContain('/me/following?type=artist&limit=1&after=cursor_1');
    expect(p2.items.length).toBe(1);
    expect(p2.items[0]?.name).toBe('Artist 2');
    expect(p2.hasMore).toBe(true);
    expect(p2.nextCursor).toBe('cursor_2');
    expect(p2.nextOffset).toBe(2);

    // Page 3: with explicit cursor
    const p3 = await endpoints.getLibraryPage('followed_artists', 2, 1, 'cursor_2');
    expect(urls[2]).toContain('/me/following?type=artist&limit=1&after=cursor_2');
    expect(p3.items.length).toBe(1);
    expect(p3.items[0]?.name).toBe('Artist 3');
    expect(p3.hasMore).toBe(false);
  });
});
