import { describe, expect, it } from 'bun:test';
import { HomeManager } from '../src/home';
import { WebApiClient } from '../src/webApi';
import { EntityEndpoints } from '../src/webApi/entityEndpoints';
import type { Transport } from '../src/webApi/transport';
import { ensureHomeTab } from '../src/main/homeLoad';
import { initialHomeTabs } from '../src/home/tabs';
import type { AppState } from '../src/main/types';
import type { EntityManager } from '../src/entities';
import type { Ui } from '../src/ui';
import type { HomeRow } from '../src/ui/views/homeRows';

const track = {
  id: 't',
  uri: 'spotify:track:t',
  name: 'Test track',
  artists: [],
  durationMs: 1000,
};

function setup() {
  let rows: HomeRow[] = [];
  const ui = {
    setHomeItems: (next: HomeRow[]) => {
      rows = next;
    },
    setStatus: () => {},
  } as unknown as Ui;
  const state = { homeTabs: initialHomeTabs() } as AppState;
  const homeManager = {
    loadForYou: async () => ({ topTracks: [track], topArtists: [], range: 'medium_term' }),
    loadRecentlyPlayed: async () => ({ items: [] }),
  } as unknown as HomeManager;
  const entityManager = {
    loadNewReleases: async () => [],
    loadRecommendations: async () => [],
    checkMembership: async () => [],
  } as unknown as EntityManager;
  return { deps: { homeManager, entityManager, state, getUi: () => ui }, rows: () => rows };
}

describe('Home runtime boundaries', () => {
  it('propagates endpoint failures instead of caching a successful empty Home', async () => {
    const endpoints = new EntityEndpoints({
      request: async () => {
        throw new Error('FORBIDDEN: insufficient scope');
      },
    } as unknown as Transport);
    const manager = new HomeManager({
      getUserTopTracks: endpoints.getUserTopTracks.bind(endpoints),
      getUserTopArtists: endpoints.getUserTopArtists.bind(endpoints),
      getRecentlyPlayed: endpoints.getRecentlyPlayed.bind(endpoints),
    } as unknown as WebApiClient);
    await expect(manager.loadForYou()).rejects.toThrow('FORBIDDEN');
    await expect(manager.loadRecentlyPlayed()).rejects.toThrow('FORBIDDEN');
  });

  it('paints available tracks before Discover completes', async () => {
    const { deps, rows } = setup();
    const pending = Promise.withResolvers<never[]>();
    deps.entityManager.loadNewReleases = () => pending.promise;
    const loading = ensureHomeTab(deps, 'for_you');
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rows().some((row) => row.kind === 'track')).toBe(true);
    } finally {
      pending.resolve([]);
      await loading;
    }
  });

  it('does not invent recently played history from top tracks', async () => {
    const { deps, rows } = setup();
    await ensureHomeTab(deps, 'for_you');
    const start = rows().findIndex(
      (row) => row.kind === 'header' && row.text.startsWith('Recently Played'),
    );
    expect(rows()[start + 1]?.kind).not.toBe('track');
  });

  it('does not suggest reauthorization for a network error', async () => {
    const { deps, rows } = setup();
    deps.homeManager.loadForYou = async () => {
      throw new Error('Connection refused');
    };
    await ensureHomeTab(deps, 'for_you');
    expect(rows().some((row) => row.kind === 'header' && row.text.includes('reauthorize'))).toBe(
      false,
    );
  });

  it('ignores an older load after the user changes the time range', async () => {
    const { deps, rows } = setup();
    const pending = Promise.withResolvers<Awaited<ReturnType<HomeManager['loadForYou']>>>();
    deps.homeManager.loadForYou = (range) =>
      range === 'medium_term'
        ? pending.promise
        : Promise.resolve({
            topTracks: [{ ...track, name: 'New range' }],
            topArtists: [],
            range: 'short_term',
          });
    const old = ensureHomeTab(deps, 'for_you');
    deps.state.homeTabs.range = 'short_term';
    await ensureHomeTab(deps, 'for_you');
    pending.resolve({ topTracks: [track], topArtists: [], range: 'medium_term' });
    await old;
    expect(rows().some((row) => row.kind === 'track' && row.track.name === 'New range')).toBe(true);
    expect(deps.state.homeTabs.range).toBe('short_term');
  });
});
