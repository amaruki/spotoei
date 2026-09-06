import { describe, expect, it } from 'bun:test';
import { getBrowseCategories, getCategoryPlaylists } from '../src/webApi/browseEndpoints';
import {
  fetchLiveBrowseCategories,
  fetchLiveCategoryEntries,
  buildBrowseCategories,
} from '../src/browse';
import { DISCOVER_ENTRIES } from '../src/browse/data';
import type { Transport } from '../src/webApi/transport';
import { ApiError } from '../src/webApi/transport';

function mockTransport(handler: (path: string, params?: unknown) => unknown): Transport {
  return { request: handler } as unknown as Transport;
}

describe('Live Browse Categories & Playlists endpoints', () => {
  it('getBrowseCategories requests /browse/categories and parses categories', async () => {
    let capturedPath = '';
    const transport = mockTransport(async (path: string) => {
      capturedPath = path;
      return {
        categories: {
          items: [
            { id: 'toplists', name: 'Top Lists', icons: [{ url: 'http://img.jpg' }] },
            { id: 'rock', name: 'Rock' },
          ],
        },
      };
    });

    const categories = await getBrowseCategories(transport, 10, 5);
    expect(capturedPath).toContain('/browse/categories?');
    expect(capturedPath).toContain('limit=10');
    expect(capturedPath).toContain('offset=5');
    expect(categories.length).toBe(2);
    expect(categories[0]?.id).toBe('toplists');
    expect(categories[0]?.name).toBe('Top Lists');
    expect(categories[1]?.id).toBe('rock');
  });

  it('getCategoryPlaylists requests /browse/categories/{id}/playlists and parses playlists', async () => {
    let capturedPath = '';
    const transport = mockTransport(async (path: string) => {
      capturedPath = path;
      return {
        playlists: {
          items: [
            {
              id: 'pl1',
              name: 'Today Top Hits',
              uri: 'spotify:playlist:pl1',
              tracks: { total: 50 },
            },
          ],
        },
      };
    });

    const playlists = await getCategoryPlaylists(transport, 'top lists', 15, 0);
    expect(capturedPath).toContain(`/browse/categories/${encodeURIComponent('top lists')}/playlists?`);
    expect(capturedPath).toContain('limit=15');
    expect(playlists.length).toBe(1);
    expect(playlists[0]?.id).toBe('pl1');
    expect(playlists[0]?.name).toBe('Today Top Hits');
  });
});

describe('Live Browse Category integration in browse.ts with fallback', () => {
  it('fetchLiveBrowseCategories returns mapped live categories when API succeeds', async () => {
    const transport = mockTransport(async () => ({
      categories: {
        items: [
          { id: 'cat1', name: 'Category 1' },
          { id: 'discover', name: 'Discover' },
        ],
      },
    }));

    const result = await fetchLiveBrowseCategories(transport);
    expect(result.length).toBe(2);
    expect(result[0]?.id).toBe('cat1');
    expect(result[0]?.label).toBe('Category 1');
    expect(result[1]?.id).toBe('discover');
    // discover category retains DISCOVER_ENTRIES
    expect(result[1]?.entries).toEqual(DISCOVER_ENTRIES);
  });

  it('fetchLiveBrowseCategories falls back to static categories on offline / network error', async () => {
    const transport = mockTransport(async () => {
      throw new TypeError('fetch failed: offline');
    });

    const result = await fetchLiveBrowseCategories(transport);
    const staticExpected = buildBrowseCategories();
    expect(result.length).toBe(staticExpected.length);
    expect(result[0]?.id).toBe('discover');
    expect(result[0]?.entries).toEqual(DISCOVER_ENTRIES);
  });

  it('fetchLiveBrowseCategories falls back to static categories on rate limit (429)', async () => {
    const transport = mockTransport(async () => {
      throw new ApiError('API_RATE_LIMITED', '429 Too Many Requests', 429, true);
    });

    const result = await fetchLiveBrowseCategories(transport);
    expect(result[0]?.id).toBe('discover');
    expect(result[0]?.entries).toEqual(DISCOVER_ENTRIES);
  });

  it('fetchLiveBrowseCategories falls back on 403 / general error', async () => {
    const transport = mockTransport(async () => {
      throw new ApiError('FORBIDDEN', '403 Forbidden', 403, false);
    });

    const result = await fetchLiveBrowseCategories(transport);
    expect(result[0]?.id).toBe('discover');
    expect(result[0]?.entries).toEqual(DISCOVER_ENTRIES);
  });

  it('fetchLiveCategoryEntries falls back to DISCOVER_ENTRIES on error for discover', async () => {
    const transport = mockTransport(async () => {
      throw new Error('network down');
    });

    const entries = await fetchLiveCategoryEntries(transport, 'discover');
    expect(entries).toEqual(DISCOVER_ENTRIES);
  });
});
