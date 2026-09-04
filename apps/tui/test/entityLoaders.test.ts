import { describe, expect, it } from 'bun:test';
import type { CatalogAlbumT, CatalogTrackT } from 'spotoei-protocol';
import type { EntityManager } from '../src/entities';
import {
  ensureEntityRoute,
  loadMoreEntityItems,
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
    setStatus: (msg: string) => {
      statuses.push(msg);
    },
  } as unknown as Ui;
  const state = { entityPages: {} } as AppState;
  return { deps: { entityManager: manager, getUi: () => ui, state }, setCalls, statuses, calls };
}

describe('entity loaders', () => {
  it('loads the first artist albums page on route entry', async () => {
    const { deps, setCalls } = setup({});
    await ensureEntityRoute(deps, { kind: 'artist', id: 'art1' });
    expect(setCalls).toEqual([{ what: 'albums', count: 2, append: undefined }]);
  });

  it('does not refetch a loaded route but re-sets cached items', async () => {
    const { deps, setCalls, calls } = setup({});
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    expect(calls.filter((c) => c.startsWith('tracks:')).length).toBe(1);
    expect(setCalls.length).toBe(2);
  });

  it('appends the next page when selection reaches the end', async () => {
    const { deps, setCalls } = setup({});
    await ensureEntityRoute(deps, { kind: 'album', id: 'al1' });
    await loadMoreEntityItems(deps, 'album', 'al1');
    expect(setCalls[1]).toEqual({ what: 'tracks', count: 2, append: true });
  });

  it('switches artist release groups independently', async () => {
    const { deps, setCalls, calls } = setup({});
    await ensureEntityRoute(deps, { kind: 'artist', id: 'art1' });
    await switchArtistGroup(deps, 'art1', 'single');
    expect(calls).toContain('albums:art1:single:0');
    expect(setCalls.length).toBe(2);
  });

  it('keeps failures page-local without throwing', async () => {
    const manager = {
      loadAlbumTracks: async () => {
        throw new Error('403 forbidden');
      },
    } as unknown as EntityManager;
    const statuses: string[] = [];
    const ui = {
      setAlbumTracks: () => {},
      setStatus: (m: string) => statuses.push(m),
    } as unknown as Ui;
    const state = { entityPages: {} } as AppState;
    await ensureEntityRoute(
      { entityManager: manager, getUi: () => ui, state },
      { kind: 'album', id: 'x' },
    );
    expect(statuses[statuses.length - 1]).toContain('Album tracks failed');
  });
});
