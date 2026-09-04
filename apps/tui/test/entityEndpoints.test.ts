import { describe, expect, it } from 'bun:test';

import { EntityEndpoints } from '../src/webApi/entityEndpoints';
import type { Transport } from '../src/webApi/transport';

const createMockTransport = (handler: (path: string) => Promise<unknown>): Transport => {
  return {
    request: handler,
  } as unknown as Transport;
};

describe('EntityEndpoints.getArtistView', () => {
  it('returns complete artist view when payload is valid', async () => {
    const rawArtist = {
      id: 'a1',
      uri: 'spotify:artist:a1',
      name: 'Test Artist',
      genres: ['rock'],
      followers: { total: 100 },
      images: [{ url: 'https://img.com/a.jpg' }],
    };
    const transport = createMockTransport(async (path) => {
      if (path === '/artists/a1') return rawArtist;
      throw new Error(`Unexpected path: ${path}`);
    });
    const endpoints = new EntityEndpoints(transport);
    const result = await endpoints.getArtistView('a1');

    expect(result.type).toBe('artist');
    expect(result.completeness).toBe('complete');
    if (result.type === 'artist') {
      expect(result.artist.name).toBe('Test Artist');
      expect(result.artist.genres).toEqual(['rock']);
    }
  });

  it('returns unavailable artist view when transport throws', async () => {
    const transport = createMockTransport(async () => {
      throw new Error('Not found');
    });
    const endpoints = new EntityEndpoints(transport);
    const result = await endpoints.getArtistView('bad-id');

    expect(result.type).toBe('artist');
    expect(result.completeness).toBe('unavailable');
    if (result.type === 'artist') {
      expect(result.artist.name).toBe('Unavailable artist');
      expect(result.reason).toBe('Not found');
    }
  });
});

describe('EntityEndpoints.getArtistAlbums', () => {
  it('parses paginated album results and sets hasMore', async () => {
    const rawResponse = {
      items: [
        {
          id: 'al1',
          uri: 'spotify:album:al1',
          name: 'Album 1',
          artists: [{ id: 'a1', name: 'Artist 1', uri: 'spotify:artist:a1' }],
        },
      ],
      total: 10,
      offset: 0,
      limit: 1,
    };
    const transport = createMockTransport(async () => rawResponse);
    const endpoints = new EntityEndpoints(transport);
    const result = await endpoints.getArtistAlbums('a1', 'album', 0, 1);

    expect(result.items.length).toBe(1);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.items[0]?.name).toBe('Album 1');
  });

  it('returns empty result when request fails', async () => {
    const transport = createMockTransport(async () => {
      throw new Error('API error');
    });
    const endpoints = new EntityEndpoints(transport);
    const result = await endpoints.getArtistAlbums('a1');

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

describe('EntityEndpoints.getAlbumTracks', () => {
  it('parses tracks and sets hasMore correctly', async () => {
    const rawResponse = {
      items: [
        {
          id: 't1',
          uri: 'spotify:track:t1',
          name: 'Track 1',
          artists: [{ id: 'a1', name: 'Artist', uri: 'spotify:artist:a1' }],
          duration_ms: 120_000,
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    };
    const transport = createMockTransport(async () => rawResponse);
    const endpoints = new EntityEndpoints(transport);
    const result = await endpoints.getAlbumTracks('al1');

    expect(result.items.length).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.items[0]?.name).toBe('Track 1');
  });
});
