import { describe, expect, it } from 'bun:test';
import type { CatalogArtistT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../src/entities';
import type { HomeManager } from '../src/home';
import { initialHomeTabs } from '../src/home/tabs';
import { ensureHomeTab } from '../src/main/homeLoad';
import type { AppState } from '../src/main/types';
import { homeRowOptions } from '../src/ui/views/homeRows';
import type { Ui } from '../src/ui/types';

const track = (id: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  durationMs: 180000,
});

const artist = (id: string): CatalogArtistT => ({
  id,
  uri: `spotify:artist:${id}`,
  name: id,
});

function setup(opts?: { forYouError?: string; recentError?: string }) {
  const homeManager = {
    loadForYou: async () => {
      if (opts?.forYouError) throw new Error(opts.forYouError);
      return { topTracks: [track('t1')], topArtists: [artist('a1')], range: 'medium_term' };
    },
    loadRecentlyPlayed: async () => {
      if (opts?.recentError) throw new Error(opts.recentError);
      return { items: [{ track: track('r1'), playedAt: '2026-09-01T10:00:00.000Z' }] };
    },
  } as unknown as HomeManager;
  const entityManager = {
    checkMembership: async (uris: string[]) =>
      uris.map((uri) => ({ uri, kind: 'track', state: 'saved' })),
    loadNewReleases: async () => [],
    loadAlbumTracks: async () => ({ items: [], total: 0 }),
    loadRecommendations: async () => [track('d1')],
  } as unknown as EntityManager;
  let rows: unknown[] = [];
  let meta: { error?: string } | undefined;
  const ui = {
    setHomeItems: (r: unknown[], m?: { error?: string }) => {
      rows = r;
      meta = m;
    },
    setStatus: () => {},
  } as unknown as Ui;
  const state = { homeTabs: initialHomeTabs() } as AppState;
  const deps = { homeManager, entityManager, getUi: () => ui, state };
  return { deps, rows: () => rows, meta: () => meta, state: () => state };
}

describe('home loaders', () => {
  it('loads For You sections with range header', async () => {
    const { deps, rows } = setup();
    await ensureHomeTab(deps, 'for_you');
    const options = homeRowOptions(rows() as never);
    expect(options.some((o) => o.name.includes('Top Tracks'))).toBe(true);
    expect(options.some((o) => o.name.includes('Top Artists'))).toBe(true);
    expect(options.some((o) => o.name.includes('6 months'))).toBe(true);
  });

  it('marks saved tracks and local timestamps in Recently Played', async () => {
    const { deps, rows } = setup();
    await ensureHomeTab(deps, 'recently_played');
    const options = homeRowOptions(rows() as never);
    expect(options.some((o) => o.name.includes('♥'))).toBe(true);
    expect(options.some((o) => o.description.includes('Sep'))).toBe(true);
  });

  it('keeps scope failures tab-local with reauth hints', async () => {
    const { deps, rows, state } = setup({ forYouError: 'missing user-top-read' });
    await ensureHomeTab(deps, 'for_you');
    const options = homeRowOptions(rows() as never);
    // For You failure degrades its own section; other panels still paint.
    expect(options.some((o) => o.name.includes('reauthorize'))).toBe(true);
    expect(options.some((o) => o.name.includes('Recently Played'))).toBe(true);
    expect(options.some((o) => o.name.includes('Discover'))).toBe(true);
    expect(state().homeTabs.forYouError).toContain('user-top-read');
    expect(state().homeTabs.recentError).toBeUndefined();
  });

  it('paints all four panels with real tracks on start', async () => {
    const { deps, rows } = setup();
    await ensureHomeTab(deps, 'for_you');
    const flat = rows() as Array<{ kind: string; track?: { uri: string } }>;
    const tracks = flat.filter((r) => r.kind === 'track');
    // Top Tracks + Recently Played + Discover preview, all playable.
    expect(tracks.length).toBeGreaterThanOrEqual(3);
    for (const t of tracks) {
      expect(t.track?.uri.startsWith('spotify:track:')).toBe(true);
    }
    expect(flat.some((r) => r.kind === 'artist')).toBe(true);
  });
});
