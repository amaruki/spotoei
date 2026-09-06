import { describe, expect, it } from 'bun:test';
import { CatalogEndpoints } from '../src/webApi/catalog';
import { createSearchClient } from '../src/search';
import { Cache } from '../src/cache';
import type { Transport } from '../src/webApi/transport';
import type { WebApiClient } from '../src/webApi';

function mockTransport(handler: (path: string, params?: unknown) => unknown): Transport {
  return { request: handler } as unknown as Transport;
}

describe('Extended Search with shows and episodes', () => {
  it('requests 6 types by default and returns shows/episodes with paging collections', async () => {
    let capturedPath = '';
    let capturedParams: Record<string, string> = {};

    const transport = mockTransport(async (path: string, params: unknown) => {
      capturedPath = path;
      capturedParams = params as Record<string, string>;
      return {
        tracks: { items: [{ id: 't1', name: 'Track 1', uri: 'spotify:track:t1', duration_ms: 1000 }] },
        shows: {
          items: [{ id: 's1', name: 'Show 1', uri: 'spotify:show:s1', publisher: 'Podcast Co', total_episodes: 12 }],
          total: 1,
          limit: 10,
          offset: 0,
        },
        episodes: {
          items: [{ id: 'e1', name: 'Episode 1', uri: 'spotify:episode:e1', duration_ms: 60000, release_date: '2026-01-01' }],
          total: 1,
          limit: 10,
          offset: 0,
        },
      };
    });

    const catalog = new CatalogEndpoints(transport);
    const res = await catalog.search('podcast');

    expect(capturedPath).toBe('/search');
    expect(capturedParams.type).toBe('track,album,artist,playlist,show,episode');
    expect(capturedParams.q).toBe('podcast');

    expect(res.hits.length).toBe(3);
    const showHit = res.hits.find((h) => h.type === 'show');
    const epHit = res.hits.find((h) => h.type === 'episode');
    const trackHit = res.hits.find((h) => h.type === 'track');

    expect(showHit).toBeDefined();
    if (showHit && showHit.type === 'show') {
      expect(showHit.show.id).toBe('s1');
      expect(showHit.show.name).toBe('Show 1');
      expect(showHit.show.publisher).toBe('Podcast Co');
    }

    expect(epHit).toBeDefined();
    if (epHit && epHit.type === 'episode') {
      expect(epHit.episode.id).toBe('e1');
      expect(epHit.episode.name).toBe('Episode 1');
    }

    expect(trackHit).toBeDefined();

    // Paging collections
    expect(res.shows).toBeDefined();
    expect(res.shows?.items.length).toBe(1);
    expect(res.shows?.total).toBe(1);
    expect(res.episodes).toBeDefined();
    expect(res.episodes?.items.length).toBe(1);
    expect(res.episodes?.total).toBe(1);
  });

  it('SearchClient passes extended types through to webApi', async () => {
    let capturedTypes: unknown[] = [];
    const webApi = {
      search: async (_q: string, types?: unknown[]) => {
        capturedTypes = types ?? [];
        return {
          query: _q,
          hits: [{ type: 'show', show: { id: 's1', name: 'S1', uri: 'spotify:show:s1' } }],
        };
      },
    } as unknown as WebApiClient;

    const cache = new Cache();
    const client = createSearchClient({
      webApi,
      cache,
      accountId: 'test',
      debounceMs: 5,
    });

    const res = await client.search('test');
    expect(capturedTypes).toEqual(['track', 'album', 'artist', 'playlist', 'show', 'episode']);
    expect(res.hits.length).toBe(1);
    expect(res.hits[0]?.type).toBe('show');
    client.close();
  });
});
