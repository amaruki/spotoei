import { describe, expect, it } from 'bun:test';
import type { CatalogArtistT, CatalogTrackT, RecentlyPlayedItemT } from 'spotoei-protocol';

import { Cache } from '../src/cache';
import { createInitialHomeState, HomeManager } from '../src/home';
import type { WebApiClient } from '../src/webApi';

const fakeTrack: CatalogTrackT = {
  id: 't1',
  uri: 'spotify:track:t1',
  name: 'Track 1',
  artists: [{ id: 'a1', name: 'Artist 1', uri: 'spotify:artist:a1' }],
  durationMs: 200_000,
};

const fakeArtist: CatalogArtistT = {
  id: 'a1',
  uri: 'spotify:artist:a1',
  name: 'Artist 1',
};

const fakeRecent: RecentlyPlayedItemT = {
  track: fakeTrack,
  playedAt: '2026-09-04T12:00:00Z',
};

const createMockClient = (overrides: Partial<WebApiClient> = {}): WebApiClient => {
  return {
    getUserTopTracks: async () => [fakeTrack],
    getUserTopArtists: async () => [fakeArtist],
    getRecentlyPlayed: async () =>
      [fakeRecent] as unknown as Awaited<ReturnType<WebApiClient['getRecentlyPlayed']>>,
    ...overrides,
  } as unknown as WebApiClient;
};

describe('createInitialHomeState', () => {
  it('initializes with for_you tab and medium_term range', () => {
    const state = createInitialHomeState();
    expect(state.activeTab).toBe('for_you');
    expect(state.timeRange).toBe('medium_term');
    expect(state.loading).toBe(false);
    expect(state.error).toBeUndefined();
    expect(state.forYou).toBeUndefined();
    expect(state.recentlyPlayed).toBeUndefined();
  });
});

describe('HomeManager', () => {
  it('loads For You data combining top tracks and top artists', async () => {
    const client = createMockClient();
    const manager = new HomeManager(client);
    const data = await manager.loadForYou('short_term');

    expect(data.range).toBe('short_term');
    expect(data.topTracks.length).toBe(1);
    expect((data.topTracks[0] as CatalogTrackT).name).toBe('Track 1');
    expect(data.topArtists.length).toBe(1);
    expect((data.topArtists[0] as CatalogArtistT).name).toBe('Artist 1');
  });

  it('loads Recently Played data', async () => {
    const client = createMockClient();
    const manager = new HomeManager(client);
    const data = await manager.loadRecentlyPlayed();

    expect(data.items.length).toBe(1);
    expect(((data.items[0]?.track as CatalogTrackT) || fakeTrack).name).toBe('Track 1');
    expect(data.items[0]?.playedAt).toBe('2026-09-04T12:00:00Z');
  });

  it('uses cache on subsequent loadForYou calls', async () => {
    let callCount = 0;
    const client = createMockClient({
      getUserTopTracks: async () => {
        callCount++;
        return [fakeTrack];
      },
    });

    const cache = new Cache({ filename: ':memory:' });
    const manager = new HomeManager(client, cache);

    await manager.loadForYou('medium_term');
    expect(callCount).toBe(1);

    await manager.loadForYou('medium_term');
    expect(callCount).toBe(1);

    await manager.loadForYou('medium_term', true);
    expect(callCount).toBe(2);
  });

  it('uses cache on subsequent loadRecentlyPlayed calls', async () => {
    let callCount = 0;
    const client = createMockClient({
      getRecentlyPlayed: async () => {
        callCount++;
        return [fakeRecent] as unknown as Awaited<ReturnType<WebApiClient['getRecentlyPlayed']>>;
      },
    });

    const cache = new Cache({ filename: ':memory:' });
    const manager = new HomeManager(client, cache);

    await manager.loadRecentlyPlayed();
    expect(callCount).toBe(1);

    await manager.loadRecentlyPlayed();
    expect(callCount).toBe(1);

    await manager.loadRecentlyPlayed(true);
    expect(callCount).toBe(2);
  });
});
