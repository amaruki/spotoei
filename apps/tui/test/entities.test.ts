import { describe, expect, it } from 'bun:test';
import type { EntityViewResponseT } from 'spotoei-protocol';

import { Cache } from '../src/cache';
import { EntityManager } from '../src/entities';
import type { WebApiClient } from '../src/webApi';

describe('EntityManager', () => {
  const fakeAlbumView = {
    type: 'album' as const,
    album: {
      id: 'alb123',
      uri: 'spotify:album:alb123',
      name: 'Test Album',
      artists: [{ id: 'art1', name: 'Test Artist', uri: 'spotify:artist:art1' }],
    },
    sections: [
      {
        kind: 'tracks' as const,
        title: 'Tracks',
        items: [
          {
            type: 'track' as const,
            track: {
              id: 'trk1',
              uri: 'spotify:track:trk1',
              name: 'Track One',
              artists: [{ id: 'art1', name: 'Test Artist', uri: 'spotify:artist:art1' }],
              durationMs: 180_000,
            },
          },
        ],
      },
    ],
  } as unknown as EntityViewResponseT;

  const fakeArtistView = {
    type: 'artist' as const,
    artist: { id: 'art1', uri: 'spotify:artist:art1', name: 'Artist' },
    sections: [],
  } as unknown as EntityViewResponseT;

  const fakePlaylistView = {
    type: 'playlist' as const,
    playlist: { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Playlist' },
    sections: [],
  } as unknown as EntityViewResponseT;

  const createMockClient = (overrides: Partial<WebApiClient> = {}): WebApiClient => {
    return {
      getAlbumView: async () => fakeAlbumView,
      getArtistView: async () => fakeArtistView,
      getPlaylistView: async () => fakePlaylistView,
      ...overrides,
    } as unknown as WebApiClient;
  };

  it('loads album view and extracts tracks section', async () => {
    let calledId = '';
    const client = createMockClient({
      getAlbumView: async (id: string) => {
        calledId = id;
        return fakeAlbumView;
      },
    });

    const manager = new EntityManager(client);
    const view = (await manager.loadAlbum('alb123')) as unknown as {
      type: string;
      album: { id: string; name: string };
      sections: Array<{ kind: string; items: unknown[] }>;
    };

    expect(calledId).toBe('alb123');
    expect(view.type).toBe('album');
    expect(view.album.id).toBe('alb123');
    expect(view.sections.length).toBe(1);
    expect(view.sections[0]?.kind).toBe('tracks');
    expect(view.sections[0]?.items.length).toBe(1);
  });

  it('uses cache on subsequent loads when not forced', async () => {
    let callCount = 0;
    const client = createMockClient({
      getAlbumView: async () => {
        callCount++;
        return fakeAlbumView;
      },
    });

    const cache = new Cache();
    const manager = new EntityManager(client, cache);

    await manager.loadAlbum('alb123');
    expect(callCount).toBe(1);

    const cached = (await manager.loadAlbum('alb123')) as unknown as { type: string };
    expect(callCount).toBe(1);
    expect(cached.type).toBe('album');

    await manager.loadAlbum('alb123', true);
    expect(callCount).toBe(2);
  });

  it('loads artist view', async () => {
    let calledId = '';
    const client = createMockClient({
      getArtistView: async (id: string) => {
        calledId = id;
        return fakeArtistView;
      },
    });

    const manager = new EntityManager(client);
    const view = (await manager.loadArtist('art1')) as unknown as {
      type: string;
      artist: { id: string; name: string };
    };

    expect(calledId).toBe('art1');
    expect(view.type).toBe('artist');
    expect(view.artist.id).toBe('art1');
    expect(view.artist.name).toBe('Artist');
  });

  it('loads playlist view', async () => {
    let calledId = '';
    const client = createMockClient({
      getPlaylistView: async (id: string) => {
        calledId = id;
        return fakePlaylistView;
      },
    });

    const manager = new EntityManager(client);
    const view = (await manager.loadPlaylist('pl1')) as unknown as {
      type: string;
      playlist: { id: string; name: string };
    };

    expect(calledId).toBe('pl1');
    expect(view.type).toBe('playlist');
    expect(view.playlist.id).toBe('pl1');
  });

  it('returns different album views for different ids', async () => {
    const seenIds: string[] = [];
    const client = createMockClient({
      getAlbumView: async (id: string) => {
        seenIds.push(id);
        return {
          ...(fakeAlbumView as Record<string, unknown>),
          album: {
            ...(
              fakeAlbumView as unknown as {
                album: { id: string; name: string; uri: string; artists: unknown[] };
              }
            ).album,
            id,
          },
        } as unknown as EntityViewResponseT;
      },
    });

    const manager = new EntityManager(client);
    await manager.loadAlbum('a');
    await manager.loadAlbum('b');
    expect(seenIds).toEqual(['a', 'b']);
  });

  it('paginates artist albums by release group and offset', async () => {
    const recordedCalls: Array<{ group?: string; offset?: number; limit?: number }> = [];
    const client = createMockClient({
      getArtistAlbums: async (_id, group = 'album', offset = 0, limit = 20) => {
        recordedCalls.push({ group, offset, limit });
        return { items: [], total: 100, offset, limit, hasMore: offset + limit < 100 };
      },
    });

    const manager = new EntityManager(client);
    const page1 = await manager.loadArtistAlbums('art1', 'album', 0, 20);
    const page2 = await manager.loadArtistAlbums('art1', 'single', 20, 20);

    expect(page1.hasMore).toBe(true);
    expect(page2.offset).toBe(20);
    expect(recordedCalls).toEqual([
      { group: 'album', offset: 0, limit: 20 },
      { group: 'single', offset: 20, limit: 20 },
    ]);
  });

  it('paginates album tracks by offset and limit', async () => {
    const recordedCalls: Array<{ offset?: number; limit?: number }> = [];
    const client = createMockClient({
      getAlbumTracks: async (_id, offset = 0, limit = 50) => {
        recordedCalls.push({ offset, limit });
        return { items: [], total: 25, offset, limit, hasMore: offset + limit < 25 };
      },
    });

    const manager = new EntityManager(client);
    const page = await manager.loadAlbumTracks('alb1', 0, 50);
    expect(page.total).toBe(25);
    expect(page.hasMore).toBe(false);
    expect(recordedCalls).toEqual([{ offset: 0, limit: 50 }]);
  });

  it('paginates playlist tracks by offset and limit', async () => {
    const recordedCalls: Array<{ offset?: number; limit?: number }> = [];
    const client = createMockClient({
      getPlaylistTracks: async (_id, offset = 0, limit = 50) => {
        recordedCalls.push({ offset, limit });
        return { items: [], total: 150, offset, limit, hasMore: true };
      },
    });

    const manager = new EntityManager(client);
    const page = await manager.loadPlaylistTracks('pl1', 100, 50);
    expect(page.hasMore).toBe(true);
    expect(recordedCalls).toEqual([{ offset: 100, limit: 50 }]);
  });
});
