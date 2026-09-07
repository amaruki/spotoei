import { describe, expect, test } from 'bun:test';
import type { CatalogTrackT } from 'spotoei-protocol';

import { createPlaybackActions } from '../src/main/playback';
import type { AppContext } from '../src/main/types';

// The player exposes Spotify Connect: the phone must see the same queue the
// terminal is playing, so every load carries the upcoming track URIs for the
// Connect context (current track first, pool order preserved).

const track = (id: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a1', name: 'Somebody', uri: 'spotify:artist:a1' }],
  albumName: 'Album',
  durationMs: 200000,
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

describe('connect queue forwarding', () => {
  test('playing a pool track sends it first, followed by the rest of the pool', async () => {
    const { actions, loads } = setup([track('t1'), track('t2'), track('t3')]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t1', title: 't1' });
    expect(loads[0]).toMatchObject({
      trackUri: 'spotify:track:t1',
      queueUris: ['spotify:track:t1', 'spotify:track:t2', 'spotify:track:t3'],
    });
  });

  test('playing mid-pool starts the queue at the current track', async () => {
    const { actions, loads } = setup([track('t1'), track('t2'), track('t3')]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t2', title: 't2' });
    expect(loads[0]).toMatchObject({
      trackUri: 'spotify:track:t2',
      queueUris: ['spotify:track:t2', 'spotify:track:t3'],
    });
  });

  test('a track outside the pool loads as a single-track queue', async () => {
    const { actions, loads } = setup([track('t1'), track('t2')]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:foreign', title: 'f' });
    expect(loads[0]).toMatchObject({
      trackUri: 'spotify:track:foreign',
      queueUris: ['spotify:track:foreign'],
    });
  });

  test('an empty pool still sends the played track as its own queue', async () => {
    const { actions, loads } = setup([]);
    await actions.playTrackOrContext({ trackUri: 'spotify:track:solo', title: 's' });
    expect(loads[0]).toMatchObject({
      trackUri: 'spotify:track:solo',
      queueUris: ['spotify:track:solo'],
    });
  });
});
