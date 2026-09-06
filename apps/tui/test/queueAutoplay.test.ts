import { describe, expect, test } from 'bun:test';
import type { CatalogTrackT } from 'spotoei-protocol';

import { createQueueActions } from '../src/main/queue';
import type { AppContext } from '../src/main/types';

const track = (id: string, artist: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: `a-${artist}`, name: artist, uri: `spotify:artist:a-${artist}` }],
  durationMs: 180000,
});

function setup(pool: CatalogTrackT[], playingUri: string) {
  const searches: string[] = [];
  const playing = pool.find((t) => t.uri === playingUri) ?? pool[0];
  const webApi = {
    getRecommendations: async () => [],
    search: async (query: string) => {
      searches.push(query);
      const artist = query;
      return {
        query,
        hits: [track(`${artist}-1`, artist), track(`${artist}-2`, artist)].map((t) => ({
          type: 'track' as const,
          track: t,
        })),
      };
    },
  };
  const ctx = {
    clients: {
      webApi,
      queueManager: {
        refresh: async () => ({ current: null, upcoming: [], revision: 0 }),
        getSnapshot: () => ({ current: null, upcoming: [], revision: 0 }),
      },
    },
    state: {
      isFetchingAutoplay: false,
      activePlaylistTracks: [...pool],
      libraryItems: [],
      currentInfo: {
        playback: {
          autoplay: true,
          track: playing
            ? {
                uri: playing.uri,
                name: playing.name,
                artists: playing.artists.map((a) => a.name),
                durationMs: playing.durationMs,
              }
            : null,
        },
      },
    },
    getUi: () => ({ setQueueSnapshot: () => {} }),
  } as unknown as AppContext;
  return { actions: createQueueActions(ctx), ctx, searches };
}

describe('ensureAutoplayTracks radio mix', () => {
  test('searches across artists and excludes pool/current tracks', async () => {
    const pool = [track('t1', 'A'), track('t2', 'B')];
    const { actions, ctx, searches } = setup(pool, 'spotify:track:t2');
    await actions.ensureAutoplayTracks();
    // Current artist first, then pool artists — more than one artist queried.
    expect(searches.length).toBeGreaterThan(1);
    expect(searches).toContain('B');
    expect(searches).toContain('A');
    const uris = ctx.state.activePlaylistTracks.map((t) => t.uri);
    // Appended tracks are new (pool had 2, radio adds more).
    expect(uris.length).toBeGreaterThan(2);
    // No duplicates and nothing already in the pool.
    expect(new Set(uris).size).toBe(uris.length);
    expect(uris.filter((u) => u === 'spotify:track:t1' || u === 'spotify:track:t2')).toHaveLength(
      2,
    );
  });

  test('does nothing when enough tracks remain', async () => {
    const pool = [
      track('t1', 'A'),
      track('t2', 'A'),
      track('t3', 'A'),
      track('t4', 'A'),
      track('t5', 'A'),
      track('t6', 'A'),
    ];
    const { actions, ctx, searches } = setup(pool, 'spotify:track:t1');
    await actions.ensureAutoplayTracks();
    expect(searches).toEqual([]);
    expect(ctx.state.activePlaylistTracks).toHaveLength(6);
  });
});
