// @ts-nocheck
import { describe, expect, it } from 'bun:test';
import { Cache } from '../src/cache';
import { getCategoryPlaylistsCached, getLiveCategories } from '../src/main/browseLive';
import { BrowseEndpoints } from '../src/webApi/browseEndpoints';
import type { Transport } from '../src/webApi/transport';
import type { WebApiClient } from '../src/webApi';

function mockTransport(handler: (path: string) => unknown): Transport {
  return { request: handler } as unknown as Transport;
}

describe('browseLive locale normalization', () => {
  it('normalizes EN to en_US, passes en and en_US through', async () => {
    const seen: string[] = [];
    const transport = mockTransport(async (path: string) => {
      const u = new URL(path, 'https://api.spotify.com');
      seen.push(u.searchParams.get('locale') ?? '');
      return { categories: { items: [{ id: 'x', name: 'X' }] } };
    });
    const api = new BrowseEndpoints(transport) as unknown as WebApiClient;
    // matrix EN/en/en_US/invalid
    const localeCases: Array<[string, string]> = [
      ['EN', 'en_US'],
      ['en', 'en'],
      ['en_US', 'en_US'],
      ['xx', 'xx'],
      ['en_us', 'en_US'],
      ['invalid', 'en_US'],
    ];
    for (const [input, expected] of localeCases) {
      seen.length = 0;
      await api.getCategories(input, 20, 0);
      expect(seen[0]).toBe(expected);
    }
  });

  it('getLiveCategories uses en_US normalized locale', async () => {
    let capturedLocale = '';
    const transport = mockTransport(async (path: string) => {
      capturedLocale = new URL(path, 'https://api.spotify.com').searchParams.get('locale') ?? '';
      return { categories: { items: [{ id: 'c1', name: 'Cat1' }] } };
    });
    const api = new BrowseEndpoints(transport) as unknown as WebApiClient;
    const res = await getLiveCategories(
      api as unknown as WebApiClient,
      undefined,
      'default',
      undefined,
    );
    expect(capturedLocale).toBe('en_US');
    expect(res.fallback).toBe(false);
    expect(res.categories[0]!.id).toBe('c1');
  });
});

describe('browseLive category playlists', () => {
  it('encodes categoryId in Transport.request URL', async () => {
    let capturedPath = '';
    const transport = mockTransport(async (path: string) => {
      capturedPath = path;
      return { playlists: { items: [] } };
    });
    const api = new BrowseEndpoints(transport) as unknown as WebApiClient;
    await api.getCategoryPlaylists('a/b c', 20, 0);
    expect(capturedPath).toContain(encodeURIComponent('a/b c'));
    // ensure cache key uses encodeURIComponent
    const cache = new Cache();
    const stubApi = {
      getCategoryPlaylists: async (id: string, _limit: number, _offset: number) => {
        expect(id).toBe('a/b c');
        capturedPath = `/browse/categories/${encodeURIComponent(id)}/playlists`;
        return [{ id: 'p1', name: 'P1', uri: 'spotify:playlist:p1' } as never];
      },
      getCategories: async () => [] as never,
    } as unknown as WebApiClient;
    capturedPath = '';
    await getCategoryPlaylistsCached(stubApi, cache, 'default', 'a/b c');
    const key = `browse:category:${encodeURIComponent('a/b c')}:playlists:0`;
    const cached = cache.getQuery('default', key);
    expect(cached).not.toBeNull();
  });

  it('caches empty playlists with 60s poison TTL', async () => {
    const cache = new Cache();
    const api = {
      getCategoryPlaylists: async () => [] as never,
      getCategories: async () => [] as never,
    } as unknown as WebApiClient;
    const start = Date.now();
    await getCategoryPlaylistsCached(api, cache, 'default', 'empty-cat');
    const key = `browse:category:${encodeURIComponent('empty-cat')}:playlists:0`;
    const cached = cache.getQuery('default', key);
    expect(cached).not.toBeNull();
    const ttl = (cached!.expiresAt ?? 0) - start;
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThan(70_000);
  });

  it('throws AbortError instead of fallback', async () => {
    const api = {
      getCategories: async (
        _locale: string,
        _limit: number,
        _offset: number,
        signal?: AbortSignal,
      ) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        throw new DOMException('Aborted', 'AbortError');
      },
      getCategoryPlaylists: async () => [] as never,
    } as unknown as WebApiClient;
    const ctrl = new AbortController();
    ctrl.abort();
    let threw = false;
    try {
      await getLiveCategories(api, undefined, 'default', ctrl.signal);
    } catch (e: unknown) {
      threw = true;
      expect((e as Error).name).toBe('AbortError');
    }
    expect(threw).toBe(true);
  });

  it('distinguishes quota vs forbidden via code', async () => {
    const quotaApi = {
      getCategories: async () => {
        throw new Error('API_QUOTA_EXCEEDED: quota');
      },
      getCategoryPlaylists: async () => [] as never,
    } as unknown as WebApiClient;
    const resQuota = await getLiveCategories(quotaApi);
    expect(resQuota.fallback).toBe(true);
    expect(resQuota.code).toBe('QUOTA_EXCEEDED');

    const forbidApi = {
      getCategories: async () => {
        throw new Error('FORBIDDEN: 403 Forbidden');
      },
      getCategoryPlaylists: async () => [] as never,
    } as unknown as WebApiClient;
    const resForbid = await getLiveCategories(forbidApi);
    expect(resForbid.code).toBe('FORBIDDEN');
  });
});
