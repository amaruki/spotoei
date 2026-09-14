import { runContextAction } from '../src/main/contextMenuItems';
import { describe, expect, it } from 'bun:test';
import {
  createPlaylist,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  PlaylistMutations,
} from '../src/webApi/playlistMutations';
import { buildContextMenuItems } from '../src/main/contextMenuItems';
import type { Transport } from '../src/webApi/transport';

interface CapturedRequest {
  path: string;
  body: unknown;
  method: string;
}

const createMockTransport = (
  handler: (req: CapturedRequest) => Promise<unknown>,
): Transport & { requests: CapturedRequest[] } => {
  const requests: CapturedRequest[] = [];
  return {
    requests,
    request: async (path: string, body?: unknown, method = 'GET') => {
      const req = { path, body, method };
      requests.push(req);
      return handler(req);
    },
  } as unknown as Transport & { requests: CapturedRequest[] };
};

describe('createPlaylist', () => {
  it('throws on empty name', async () => {
    const transport = createMockTransport(async () => ({}));
    await expect(createPlaylist(transport, 'user1', '   ')).rejects.toThrow(
      'Playlist name required',
    );
  });

  it('sends POST /users/{userId}/playlists with body and maps response', async () => {
    const raw = {
      id: 'pl123',
      uri: 'spotify:playlist:pl123',
      name: 'Chill Vibes',
      description: 'Relaxing tunes',
      public: true,
      tracks: { total: 0 },
    };
    const transport = createMockTransport(async (req) => {
      expect(req.path).toBe('/users/user1/playlists');
      expect(req.method).toBe('POST');
      expect(req.body).toEqual({
        name: 'Chill Vibes',
        public: true,
        description: 'Relaxing tunes',
      });
      return raw;
    });

    const result = await createPlaylist(transport, 'user1', 'Chill Vibes', 'Relaxing tunes', true);
    expect(result.id).toBe('pl123');
    expect(result.name).toBe('Chill Vibes');
  });
});

describe('addTracksToPlaylist', () => {
  it('returns empty snapshot for empty uris', async () => {
    const transport = createMockTransport(async () => ({}));
    const res = await addTracksToPlaylist(transport, 'pl1', []);
    expect(res).toEqual({ snapshot_id: '' });
    expect(transport.requests.length).toBe(0);
  });

  it('batches >100 tracks and chains snapshot_id', async () => {
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:t${i}`);
    let callCount = 0;
    const transport = createMockTransport(async (req) => {
      callCount++;
      expect(req.path).toBe('/playlists/pl1/tracks');
      expect(req.method).toBe('POST');
      if (callCount === 1) {
        expect((req.body as { uris: string[] }).uris.length).toBe(100);
        return { snapshot_id: 'snap1' };
      }
      expect((req.body as { uris: string[]; snapshot_id: string }).uris.length).toBe(50);
      expect((req.body as { snapshot_id: string }).snapshot_id).toBe('snap1');
      return { snapshot_id: 'snap2' };
    });

    const res = await addTracksToPlaylist(transport, 'pl1', uris);
    expect(res).toEqual({ snapshot_id: 'snap2' });
    expect(callCount).toBe(2);
  });
});

describe('removeTracksFromPlaylist', () => {
  it('returns empty snapshot for empty uris', async () => {
    const transport = createMockTransport(async () => ({}));
    const res = await removeTracksFromPlaylist(transport, 'pl1', []);
    expect(res).toEqual({ snapshot_id: '' });
  });

  it('batches delete requests with tracks array and chains snapshot_id', async () => {
    const uris = Array.from({ length: 120 }, (_, i) => `spotify:track:t${i}`);
    let callCount = 0;
    const transport = createMockTransport(async (req) => {
      callCount++;
      expect(req.path).toBe('/playlists/pl1/tracks');
      expect(req.method).toBe('DELETE');
      if (callCount === 1) {
        expect((req.body as { tracks: unknown[] }).tracks.length).toBe(100);
        return { snapshot_id: 'snap-del-1' };
      }
      expect((req.body as { tracks: unknown[] }).tracks.length).toBe(20);
      expect((req.body as { snapshot_id: string }).snapshot_id).toBe('snap-del-1');
      return { snapshot_id: 'snap-del-2' };
    });

    const res = await removeTracksFromPlaylist(transport, 'pl1', uris);
    expect(res).toEqual({ snapshot_id: 'snap-del-2' });
    expect(callCount).toBe(2);
  });
});

describe('reorderPlaylistTracks', () => {
  it('validates invalid range inputs', async () => {
    const transport = createMockTransport(async () => ({}));
    await expect(reorderPlaylistTracks(transport, 'pl1', -1, 5)).rejects.toThrow(
      'invalid rangeStart',
    );
    await expect(reorderPlaylistTracks(transport, 'pl1', 0, -1)).rejects.toThrow(
      'invalid insertBefore',
    );
    await expect(reorderPlaylistTracks(transport, 'pl1', 0, 5, 0)).rejects.toThrow(
      'invalid rangeLength',
    );
    await expect(reorderPlaylistTracks(transport, 'pl1', 3, 3, 1)).rejects.toThrow('noop reorder');
    await expect(reorderPlaylistTracks(transport, 'pl1', 2, 4, 3)).rejects.toThrow(
      'insert inside range',
    );
  });

  it('calculates insert_before correctly and calls PUT /playlists/{id}/tracks', async () => {
    const transport = createMockTransport(async (req) => {
      expect(req.path).toBe('/playlists/pl1/tracks');
      expect(req.method).toBe('PUT');
      expect(req.body).toEqual({
        range_start: 2,
        insert_before: 15, // 10 + 5 when moving down
        range_length: 5,
      });
      return { snapshot_id: 'snap-reorder' };
    });

    const res = await reorderPlaylistTracks(transport, 'pl1', 2, 10, 5);
    expect(res).toEqual({ snapshot_id: 'snap-reorder' });
  });
});

describe('PlaylistMutations class', () => {
  it('exposes methods matching class API', async () => {
    const transport = createMockTransport(async () => ({ snapshot_id: 'class-snap' }));
    const mutations = new PlaylistMutations(transport);
    const addRes = await mutations.addToPlaylist('pl1', ['spotify:track:1']);
    expect(addRes).toBe('class-snap');
  });
});

describe('contextMenuItems track actions', () => {
  it('includes Add to playlist and Remove from playlist for track targets', () => {
    const actions: string[] = [];
    const items = buildContextMenuItems((a) => actions.push(a), {
      kind: 'track',
      id: 't1',
      name: 'Song',
      uri: 'spotify:track:t1',
    });

    const labels = items.map((i) => i.label);
    expect(labels).toContain('Add to playlist');
    expect(labels).toContain('Remove from playlist');

    const addItem = items.find((i) => i.label === 'Add to playlist');
    addItem?.run();
    expect(actions).toContain('add_to_playlist');

    const removeItem = items.find((i) => i.label === 'Remove from playlist');
    removeItem?.run();
    expect(actions).toContain('remove_from_playlist');
  });

  it('includes Start Song Radio and Start Artist Radio for track targets', () => {
    const actions: string[] = [];
    const items = buildContextMenuItems((a) => actions.push(a), {
      kind: 'track',
      id: 't1',
      name: 'Song',
      uri: 'spotify:track:t1',
    });

    const labels = items.map((i) => i.label);
    expect(labels).toContain('Start Song Radio');
    expect(labels).toContain('Start Artist Radio');

    const songRadioItem = items.find((i) => i.label === 'Start Song Radio');
    songRadioItem?.run();
    expect(actions).toContain('song_radio');

    const artistRadioItem = items.find((i) => i.label === 'Start Artist Radio');
    artistRadioItem?.run();
    expect(actions).toContain('artist_radio');
  });

  it('invokes playRadio when song_radio or artist_radio is triggered', async () => {
    const radioCalls: Array<{ seedUri: string; title?: string }> = [];
    let queueUpdated = false;
    let autoplayEnsured = false;

    const mockCtx = {
      clients: {
        libraryManager: { save: async () => true, remove: async () => true },
        queueManager: { add: async () => true },
      },
      state: {
        currentInfo: { auth: { accountId: 'acc1' } },
        activePlaylistTracks: [],
        libraryItems: [],
      },
      contextActions: {
        playTrackOrContext: async () => {},
        updateQueueView: async () => {
          queueUpdated = true;
        },
        ensureAutoplayTracks: async () => {
          autoplayEnsured = true;
        },
        playRadio: async (opts: { seedUri: string; title?: string }) => {
          radioCalls.push(opts);
        },
      },
    };

    await runContextAction(mockCtx as never, () => null, 'song_radio', {
      kind: 'track',
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Song Title',
    });

    expect(radioCalls).toEqual([{ seedUri: 'spotify:track:t1', title: 'Song Title' }]);
    expect(queueUpdated).toBe(true);
    expect(autoplayEnsured).toBe(true);

    await runContextAction(mockCtx as never, () => null, 'artist_radio', {
      kind: 'track',
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Song Title',
      artistUri: 'spotify:artist:a1',
      artistName: 'Artist Name',
    });

    expect(radioCalls[1]).toEqual({ seedUri: 'spotify:artist:a1', title: 'Artist Name Radio' });
  });
});
