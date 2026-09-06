import { describe, expect, it } from 'bun:test';

import { BrowseEndpoints } from '../src/webApi/browseEndpoints';
import { CatalogEndpoints } from '../src/webApi/catalog';
import type { Transport } from '../src/webApi/transport';
import { ApiError } from '../src/webApi/transport';

const track = (id: string): Record<string, unknown> => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
  duration_ms: 180000,
});

const createMockTransport = (handler: (path: string) => Promise<unknown>): Transport =>
  ({ request: handler }) as unknown as Transport;

describe('getRecommendations top-tracks fallback', () => {
  it('stops fanning out after an app-wide 403', async () => {
    const topTracksCalls: string[] = [];
    const transport = createMockTransport(async (path: string) => {
      if (path.startsWith('/recommendations')) {
        throw new ApiError('API_UNAVAILABLE', 'HTTP_404: Not Found', 404, false);
      }
      if (path.includes('/top-tracks')) {
        topTracksCalls.push(path);
        throw new ApiError('FORBIDDEN', 'FORBIDDEN: 403 Forbidden (Forbidden)', 403, false);
      }
      throw new Error(`unexpected ${path}`);
    });
    const endpoints = new CatalogEndpoints(transport);
    const tracks = await endpoints.getRecommendations({
      seedArtists: ['a1', 'a2', 'a3'],
      limit: 8,
    });
    expect(tracks).toEqual([]);
    expect(topTracksCalls.length).toBe(1);
  });

  it('continues past per-artist 404s', async () => {
    const transport = createMockTransport(async (path: string) => {
      if (path.startsWith('/recommendations')) {
        throw new ApiError('API_UNAVAILABLE', 'HTTP_404: Not Found', 404, false);
      }
      if (path.includes('/artists/a1/top-tracks')) {
        throw new ApiError('API_UNAVAILABLE', 'HTTP_404: Not Found', 404, false);
      }
      if (path.includes('/artists/a2/top-tracks')) {
        return { tracks: [track('t1'), track('t2')] };
      }
      throw new Error(`unexpected ${path}`);
    });
    const endpoints = new CatalogEndpoints(transport);
    const tracks = await endpoints.getRecommendations({
      seedArtists: ['a1', 'a2'],
      limit: 8,
    });
    expect(tracks.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('getNewReleases restriction handling', () => {
  it('returns empty on platform restriction but rethrows quota exhaustion', async () => {
    const forbidden = createMockTransport(async () => {
      throw new ApiError('FORBIDDEN', 'FORBIDDEN: 403 Forbidden (Forbidden)', 403, false);
    });
    await expect(new BrowseEndpoints(forbidden).getNewReleases(6)).resolves.toEqual([]);

    const quota = createMockTransport(async () => {
      throw new ApiError(
        'API_QUOTA_EXCEEDED',
        'QUOTA_EXCEEDED: 403 Quota exceeded (QUOTA_EXCEEDED)',
        403,
        false,
      );
    });
    await expect(new BrowseEndpoints(quota).getNewReleases(6)).rejects.toThrow('QUOTA_EXCEEDED');
  });
});
