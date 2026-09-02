import { describe, expect, test } from 'bun:test';
import { Cache } from '../src/cache';
import { WebApiClient, type TokenProvider } from '../src/webApi';
import { createSearchClient } from '../src/search';

// Synthetic TokenProvider for tests.
const fakeTokenProvider: TokenProvider = {
  async getAccessToken() {
    return 'mock-access-token-12345';
  },
};

describe('WebApiClient and SearchClient', () => {
  test('search parses mock Spotify response into Track domain entities', async () => {
    // Create an in-memory mock server using fetch mock
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search')) {
        return new Response(
          JSON.stringify({
            tracks: {
              items: [
                {
                  id: 't1',
                  name: 'Track One',
                  uri: 'spotify:track:t1',
                  duration_ms: 210000,
                  artists: [{ id: 'a1', name: 'Artist A', uri: 'spotify:artist:a1' }],
                  album: {
                    id: 'al1',
                    name: 'Album One',
                    images: [{ url: 'https://example.com/cover.jpg', width: 300, height: 300 }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const client = new WebApiClient({ tokenProvider: fakeTokenProvider });
      const res = await client.search('Track One');
      expect(res.hits.length).toBe(1);
      expect(res.hits[0].type).toBe('track');
      if (res.hits[0].type === 'track') {
        expect(res.hits[0].track.name).toBe('Track One');
        expect(res.hits[0].track.durationMs).toBe(210000);
        expect(res.hits[0].track.artists[0].name).toBe('Artist A');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('search handles 401 and classifies as AUTH_EXPIRED', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as unknown as typeof fetch;

    try {
      const client = new WebApiClient({ tokenProvider: fakeTokenProvider });
      const res = await client.search('anything');
      expect(res.hits.length).toBe(0);
      expect(res.error?.code).toBe('AUTH_EXPIRED');
      expect(res.error?.retryable).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('search handles 429 and classifies as RATE_LIMITED with Retry-After', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '5' },
      });
    }) as unknown as typeof fetch;

    try {
      const client = new WebApiClient({ tokenProvider: fakeTokenProvider });
      const res = await client.search('anything');
      expect(res.hits.length).toBe(0);
      expect(res.error?.code).toBe('RATE_LIMITED');
      expect(res.error?.retryable).toBe(true);
      expect(res.error?.message).toContain('retry after 5s');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('SearchClient debounces rapid calls and returns only final query', async () => {
    let callCount = 0;
    const queries: string[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      queries.push(url.searchParams.get('q') ?? '');
      callCount++;
      return new Response(
        JSON.stringify({ tracks: { items: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    try {
      const cache = new Cache();
      const webApi = new WebApiClient({ tokenProvider: fakeTokenProvider });
      const searchClient = createSearchClient({
        webApi,
        cache,
        accountId: 'acct1',
        debounceMs: 50,
      });

      // Fire 3 queries in rapid succession
      const p1 = searchClient.search('a');
      const p2 = searchClient.search('ab');
      const p3 = searchClient.search('abc');

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      // Only the last query should have been fetched over HTTP
      expect(callCount).toBe(1);
      expect(queries).toEqual(['abc']);
      expect(r3.query).toBe('abc');
      // Superseded intermediate queries resolve cleanly with their own query
      // name and zero hits — they must NOT receive the final query's results.
      expect(r1.query).toBe('a');
      expect(r1.hits).toEqual([]);
      expect(r2.query).toBe('ab');
      expect(r2.hits).toEqual([]);
      searchClient.close();
      cache.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('SearchClient serves fresh queries from cache without HTTP fetch', async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          tracks: {
            items: [
              {
                id: 't1',
                name: 'Cached Track',
                uri: 'spotify:track:t1',
                duration_ms: 120000,
                artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    try {
      const cache = new Cache();
      const webApi = new WebApiClient({ tokenProvider: fakeTokenProvider });
      const searchClient = createSearchClient({
        webApi,
        cache,
        accountId: 'acct1',
        debounceMs: 10,
      });

      // First call hits network
      const res1 = await searchClient.search('cached test');
      expect(callCount).toBe(1);
      expect(res1.hits.length).toBe(1);

      // Second call with same query should hit cache
      const res2 = await searchClient.search('cached test');
      expect(callCount).toBe(1); // not incremented!
      expect(res2.hits.length).toBe(1);

      searchClient.close();
      cache.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
