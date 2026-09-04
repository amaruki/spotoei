import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import type { SearchResponseT } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import { partitionSearchHits, renderHit } from '../src/ui/views/search';
import { routeKind } from '../src/ui/core/navigationStack';

const trackHit = (id: string) => ({
  type: 'track' as const,
  track: {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
    durationMs: 1000,
  },
});

const artistHit = (id: string) => ({
  type: 'artist' as const,
  artist: { id, uri: `spotify:artist:${id}`, name: id },
});

const baseState: UiViewState = {
  protocol: 1,
  playerVersion: '0.1.0',
  capabilities: ['audio'],
  auth: {
    v: PROTOCOL_VERSION,
    state: 'authenticated',
    accountId: 'u',
    scopes: [],
    storage: 'keyring',
    accessTokenExpiresAt: Date.now() + 3600_000,
    authUrl: null,
  },
  playback: null,
  queue: { current: null, upcoming: [], revision: 0 },
  visualizer: { mode: 'spectrum', fps: 30 },
};

describe('search grouping', () => {
  it('partitions hits by category with original indices', () => {
    const hits = [artistHit('a1'), trackHit('t1')] as unknown as SearchResponseT['hits'];
    const panels = partitionSearchHits(hits);
    expect(panels.tracks.map((r) => r.index)).toEqual([1]);
    expect(panels.artists.map((r) => r.index)).toEqual([0]);
    expect(panels.albums).toEqual([]);
    expect(panels.playlists).toEqual([]);
    expect(renderHit(panels.tracks[0]?.hit as never).name).toBe('♪ t1');
  });

  it('filters by entity type', () => {
    const hits = [artistHit('a1'), trackHit('t1')] as unknown as SearchResponseT['hits'];
    const panels = partitionSearchHits(hits, 'track');
    expect(panels.tracks.length).toBe(1);
    expect(panels.artists).toEqual([]);
  });

  it('panel rows resolve to hits, empty panels resolve nothing', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setSearchResults('q', {
      query: 'q',
      hits: [artistHit('a1') as never, trackHit('t1') as never],
    } as unknown as SearchResponseT);
    expect(routeKind(ui.getRoute())).toBe('search');
    // Default panel is tracks: first row maps to the track hit.
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't1' });
    await ui.shutdown();
  });

  it('type filter narrows rendered rows', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setSearchResults('q', {
      query: 'q',
      hits: [artistHit('a1') as never, trackHit('t1') as never],
    } as unknown as SearchResponseT);
    ui.setSearchFilter('track');
    const target = ui.getContextTarget();
    expect(target?.kind).toBe('track');
    expect(target?.id).toBe('t1');
    await ui.shutdown();
  });
});
