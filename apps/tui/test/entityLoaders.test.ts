import { describe, expect, it } from 'bun:test';
import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../src/entities';
import {
  ensureEntityRoute,
  loadMoreEntityItems,
  poolTracksForRoute,
  switchArtistGroup,
} from '../src/main/entityLoaders';
import type { Ui } from '../src/ui/types';
import type { AppState } from '../src/main/types';

const album = (id: string): CatalogAlbumT => ({
  id,
  uri: `spotify:album:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  releaseDate: '2024-01-01',
});

const track = (id: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  durationMs: 180000,
});

function setup(fetches: { albums?: CatalogAlbumT[]; tracks?: CatalogTrackT[]; calls?: string[] }) {
  const calls = fetches.calls ?? [];
  const manager = {
    loadArtist: async (id: string) => {
      calls.push(`artist:${id}`);
      return {
        type: 'artist' as const,
        artist: { id, uri: `spotify:artist:${id}`, name: `Artist ${id}` },
        completeness: 'complete' as const,
      };
    },
    loadAlbum: async (id: string) => {
      calls.push(`album:${id}`);
      return {
        type: 'album' as const,
        album: {
          id,
          uri: `spotify:album:${id}`,
          name: `Album ${id}`,
          artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
        },
        completeness: 'complete' as const,
      };
    },
    loadPlaylist: async (id: string) => {
      calls.push(`playlist:${id}`);
      return {
        type: 'playlist' as const,
        playlist: { id, uri: `spotify:playlist:${id}`, name: `Playlist ${id}` },
        completeness: 'complete' as const,
      };
    },
    loadArtistAlbums: async (id: string, group = 'album', offset = 0) => {
      calls.push(`albums:${id}:${group}:${offset}`);
      const items = (fetches.albums ?? [album('al1'), album('al2')]).slice(offset, offset + 2);
      return { items, total: 4, offset, limit: 2, hasMore: offset + 2 < 4 };
    },
    loadAlbumTracks: async (id: string, offset = 0) => {
      calls.push(`tracks:${id}:${offset}`);
      const all = fetches.tracks ?? [track('t1'), track('t2'), track('t3'), track('t4')];
      const items = all.slice(offset, offset + 2);
      return { items, total: 4, offset, limit: 2, hasMore: offset + 2 < 4 };
    },
    loadPlaylistTracks: async (id: string, offset = 0) => {
      calls.push(`playlist:${id}:${offset}`);
      const items = (fetches.tracks ?? [track('t1'), track('t2')]).slice(offset, offset + 2);
      return { items, total: 2, offset, limit: 100, hasMore: false };
    },
  } as unknown as EntityManager;
  const setCalls: Array<{ what: string; count: number; append?: boolean }> = [];
  const statuses: string[] = [];
  const ui = {
    setArtistAlbums: (items: CatalogAlbumT[], opts?: { append?: boolean }) => {
      setCalls.push({ what: 'albums', count: items.length, append: opts?.append });
    },
    setAlbumTracks: (items: CatalogTrackT[], opts?: { append?: boolean }) => {
      setCalls.push({ what: 'tracks', count: items.length, append: opts?.append });
    },
    setPlaylistTracks: (items: CatalogTrackT[], opts?: { append?: boolean }) => {
      setCalls.push({ what: 'playlist', count: items.length, append: opts?.append });
    },
    setArtistHeader: () => {},
    setAlbumHeader: () => {},
    setPlaylistHeader: () => {},
    setStatus: (msg: string) => {
      statuses.push(msg);
    },
  } as unknown as Ui;
  const state = { entityPages: {} } as AppState;
  return { deps: { entityManager: manager, getUi: () => ui, state }, setCalls, statuses, calls };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('entity loaders', () => {
  it('loads the first artist albums page on route entry', async () => {
    const { deps, setCalls } = setup({});
    await ensureEntityRoute(deps, { kind: 'artist', id: 'art1' });
    expect(setCalls).toEqual([{ what: 'albums', count: 2, append: undefined }]);
  });

  it('prefetches remaining artist pages in the background', async () => {
    const { deps, setCalls, calls } = setup({
      albums: [album('al1'), album('al2'), album('al3'), album('al4')],
    });
    await ensureEntityRoute(deps, { kind: 'artist', id: 'art1' });
    await flush();
    expect(calls).toContain('albums:art1:album:0');
    expect(calls).toContain('albums:art1:album:2');
    expect(setCalls).toEqual([
      { what: 'albums', count: 2, append: undefined },
      { what: 'albums', count: 2, append: true },
    ]);
  });

  it('skips background paint after navigating away but keeps cached data', async () => {
    const { deps, setCalls, calls } = setup({
      albums: [album('al1'), album('al2'), album('al3'), album('al4')],
    });
    const awayUi = {
      setArtistAlbums: (items: CatalogAlbumT[], opts?: { append?: boolean }) => {
        setCalls.push({ what: 'albums', count: items.length, append: opts?.append });
      },
      setArtistHeader: () => {},
      setStatus: () => {},
      getRoute: () => ({ kind: 'artist', id: 'other' }),
    } as unknown as Ui;
    const awayDeps = { ...deps, getUi: () => awayUi };
    await ensureEntityRoute(awayDeps, { kind: 'artist', id: 'art1' });
    await flush();
    // Fetches still happened (cache merged for a later revisit)…
    expect(calls).toContain('albums:art1:album:2');
    // …but the background append did not paint onto the foreign route.
    expect(setCalls).toEqual([{ what: 'albums', count: 2, append: undefined }]);
  });

  it('keeps manual paging alive when background prefetch fails', async () => {
    const calls: string[] = [];
    const manager = {
      loadArtist: async (id: string) => ({
        type: 'artist' as const,
        artist: { id, uri: `spotify:artist:${id}`, name: `Artist ${id}` },
        completeness: 'complete' as const,
      }),
      loadArtistAlbums: async (id: string, group = 'album', offset = 0) => {
        calls.push(`albums:${id}:${group}:${offset}`);
        if (offset > 0) throw new Error('transient 500');
        return { items: [album('al1'), album('al2')], total: 4, offset, limit: 2, hasMore: true };
      },
    } as unknown as EntityManager;
    const painted: number[] = [];
    const statuses: string[] = [];
    const ui = {
      setArtistAlbums: (items: CatalogAlbumT[], _opts?: { append?: boolean }) => {
        painted.push(items.length);
      },
      setArtistHeader: () => {},
      setStatus: (m: string) => statuses.push(m),
    } as unknown as Ui;
    const state = { entityPages: {} } as AppState;
    const bgDeps = { entityManager: manager, getUi: () => ui, state };
    await ensureEntityRoute(bgDeps, { kind: 'artist', id: 'art1' });
    await flush();
    // Only the first page painted; the failure stayed silent…
    expect(painted).toEqual([2]);
    expect(statuses.some((s) => s.includes('failed'))).toBe(false);
    // …and manual paging still works afterwards.
    await loadMoreEntityItems(bgDeps, 'artist', 'art1');
    expect(calls.filter((c) => c === 'albums:art1:album:2').length).toBeGreaterThanOrEqual(1);
  });

  it('does not refetch a loaded route but re-sets cached items', async () => {
    const { deps, setCalls, calls } = setup({});
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    await flush();
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    // Initial page + one background page; the revisit reuses the cache.
    expect(calls.filter((c) => c.startsWith('tracks:')).length).toBe(2);
    expect(setCalls.length).toBe(3);
  });

  it('background prefetch covers manual paging when selection reaches the end', async () => {
    const { deps, setCalls } = setup({});
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    await flush();
    await loadMoreEntityItems(deps, 'album', 'al1');
    // Prefetch already completed everything: initial paint + background
    // append, and the manual load-more correctly stands down.
    expect(setCalls).toEqual([
      { what: 'tracks', count: 2, append: undefined },
      { what: 'tracks', count: 2, append: true },
    ]);
  });

  it('switches artist release groups independently', async () => {
    const { deps, setCalls, calls } = setup({
      albums: [album('al1'), album('al2'), album('al3'), album('al4')],
    });
    await ensureEntityRoute(deps, { kind: 'artist', id: 'art1' });
    await switchArtistGroup(deps, 'art1', 'single');
    await flush();
    expect(calls).toContain('albums:art1:single:0');
    expect(setCalls.length).toBe(4);
  });

  it('keeps failures page-local without throwing', async () => {
    const manager = {
      loadAlbum: async () => ({
        type: 'album' as const,
        album: { id: 'x', uri: 'spotify:album:x', name: 'x', artists: [] },
        completeness: 'complete' as const,
      }),
      loadAlbumTracks: async () => {
        throw new Error('403 forbidden');
      },
    } as unknown as EntityManager;
    const statuses: string[] = [];
    const ui = {
      setAlbumTracks: () => {},
      setAlbumHeader: () => {},
      setStatus: (m: string) => statuses.push(m),
    } as unknown as Ui;
    const state = { entityPages: {} } as AppState;
    await ensureEntityRoute(
      { entityManager: manager, getUi: () => ui, state },
      { kind: 'album', id: 'x' },
    );
    expect(statuses[statuses.length - 1]).toContain('Album tracks failed');
  });

  it('explains restricted playlists instead of showing a silent empty page', async () => {
    const manager = {
      loadPlaylist: async (id: string) => ({
        type: 'playlist' as const,
        playlist: { id, uri: `spotify:playlist:${id}`, name: 'x' },
        completeness: 'unavailable' as const,
        reason: 'FORBIDDEN: 403 Forbidden',
      }),
      loadPlaylistTracks: async () => ({
        items: [],
        total: 0,
        offset: 0,
        limit: 100,
        hasMore: false,
      }),
    } as unknown as EntityManager;
    const statuses: string[] = [];
    const ui = {
      setPlaylistTracks: () => {},
      setPlaylistHeader: () => {},
      setStatus: (m: string) => statuses.push(m),
    } as unknown as Ui;
    const state = { entityPages: {} } as AppState;
    await ensureEntityRoute(
      { entityManager: manager, getUi: () => ui, state },
      { kind: 'playlist', id: 'pl1' },
    );
    expect(statuses[statuses.length - 1]).toContain('Playlist unavailable');
  });
});

describe('poolTracksForRoute', () => {
  const pageState = () =>
    ({
      entityPages: {
        'album:al1': {
          items: [track('t1'), track('t2')],
          nextOffset: 2,
          hasMore: false,
          group: '',
        },
        'playlist:pl1': { items: [track('p1')], nextOffset: 1, hasMore: false, group: '' },
      },
    }) as unknown as AppState;

  it('returns loaded album tracks for album routes', () => {
    expect(poolTracksForRoute(pageState(), { kind: 'album', id: 'al1' })?.map((t) => t.id)).toEqual(
      ['t1', 't2'],
    );
  });

  it('returns loaded playlist tracks for playlist routes', () => {
    expect(
      poolTracksForRoute(pageState(), { kind: 'playlist', id: 'pl1' })?.map((t) => t.id),
    ).toEqual(['p1']);
  });

  it('returns null for artist routes, unknown ids, and bad input', () => {
    const state = pageState();
    expect(poolTracksForRoute(state, { kind: 'artist', id: 'a1' })).toBeNull();
    expect(poolTracksForRoute(state, { kind: 'album', id: 'nope' })).toBeNull();
    expect(poolTracksForRoute(state, null)).toBeNull();
  });
});
