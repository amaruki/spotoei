import { describe, expect, test } from 'bun:test';
import type { CatalogTrackT } from 'spotoei-protocol';

import { createPlaybackActions } from '../src/main/playback';
import type { AppContext } from '../src/main/types';

const track = (id: string, durationMs = 209720): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a1', name: 'Somebody', uri: 'spotify:artist:a1' }],
  albumName: 'Album',
  durationMs,
});

function setup(pool: CatalogTrackT[] = []) {
  const loads: Record<string, unknown>[] = [];
  const playback = {
    load: async (opts: Record<string, unknown>) => {
      loads.push(opts);
      return { state: 'playing' };
    },
  };
  const ctx = {
    clients: { playback },
    state: {
      activePlaylistTracks: pool,
      libraryItems: [],
      currentInfo: { playback: null },
    },
    getUi: () => null,
  } as unknown as AppContext;
  return { actions: createPlaybackActions(ctx), loads };
}

describe('playTrackOrContext metadata forwarding', () => {
  test('forwards pool duration/artists/album into playback.load', async () => {
    const { actions, loads } = setup([track('t1')]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t1', title: 't1' });
    expect(loads.length).toBe(1);
    expect(loads[0]).toMatchObject({
      trackUri: 'spotify:track:t1',
      autoplay: true,
      durationMs: 209720,
      artists: ['Somebody'],
      album: 'Album',
    });
  });

  test('explicit meta wins over pool lookup', async () => {
    const { actions, loads } = setup([track('t1')]);
    await actions.playTrackOrContext({
      trackUri: 'spotify:track:t1',
      title: 't1',
      meta: { durationMs: 180000 },
    });
    expect(loads[0]).toMatchObject({ durationMs: 180000 });
    expect(loads[0]).not.toHaveProperty('artists');
  });

  test('omits duration when the track is unknown locally', async () => {
    const { actions, loads } = setup([]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:unknown', title: 'u' });
    expect(loads[0]).toMatchObject({ trackUri: 'spotify:track:unknown', autoplay: true });
    expect(loads[0]).not.toHaveProperty('durationMs');
  });

  test('omits zero placeholder durations from the pool', async () => {
    const { actions, loads } = setup([track('t0', 0)]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t0', title: 't0' });
    expect(loads[0]).not.toHaveProperty('durationMs');
  });
});

describe('nextTrack pool walk', () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function setupNext(pool: CatalogTrackT[], playingUri: string) {
    const loads: Record<string, unknown>[] = [];
    const ctx = {
      clients: {
        playback: {
          load: async (opts: Record<string, unknown>) => {
            loads.push(opts);
            return { state: 'playing' };
          },
        },
        webApi: {},
        queueManager: {
          getSnapshot: () => ({ current: null, upcoming: [], revision: 0 }),
        },
      },
      state: {
        activePlaylistTracks: [...pool],
        libraryItems: [],
        currentInfo: {
          playback: {
            autoplay: true,
            shuffle: false,
            track: { uri: playingUri, name: 'cur', artists: [], durationMs: 180000 },
          },
        },
      },
      getUi: () => ({ setStatus: () => {} }),
    } as unknown as AppContext;
    return { actions: createPlaybackActions(ctx), loads };
  }

  test('continues with the next pool track carrying its duration', async () => {
    const pool = [track('t1'), track('t2'), track('t3')];
    const { actions, loads } = setupNext(pool, 'spotify:track:t2');
    await actions.nextTrack();
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ trackUri: 'spotify:track:t3', durationMs: 209720 });
  });

  test('starts at the pool head when the current track is foreign', async () => {
    const pool = [track('t1'), track('t2')];
    const { actions, loads } = setupNext(pool, 'spotify:track:foreign');
    await actions.nextTrack();
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ trackUri: 'spotify:track:t1' });
  });
});
