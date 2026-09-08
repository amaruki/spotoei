import { describe, expect, test } from 'bun:test';

import { createPlaybackActions } from '../src/main/playback';
import type { AppContext } from '../src/main/types';

// Local playback needs a dedicated streaming login (Step 2/2). When it is
// missing and the native load fails, the app must say so and point at the
// fix instead of playing mystery audio on some other device via the cloud
// fallback.

function setup(opts: { loadFails: boolean; streaming: boolean }) {
  const loads: Record<string, unknown>[] = [];
  const webPlays: unknown[] = [];
  const statuses: string[] = [];
  const ctx = {
    clients: {
      playback: {
        load: async (args: Record<string, unknown>) => {
          loads.push(args);
          if (opts.loadFails) throw new Error('Librespot playback unavailable');
          return { state: 'playing' };
        },
      },
      webApi: {
        play: async (args: unknown) => {
          webPlays.push(args);
        },
      },
      auth: {
        streamingStatus: async () => opts.streaming,
      },
    },
    state: {
      activePlaylistTracks: [],
      libraryItems: [],
      currentInfo: { playback: null },
    },
    getUi: () => ({ setStatus: (msg: string) => void statuses.push(msg) }),
  } as unknown as AppContext;
  return { actions: createPlaybackActions(ctx), loads, webPlays, statuses };
}

describe('missing streaming login', () => {
  test('a failed load without streaming guides to Step 2/2, no cloud fallback', async () => {
    const { actions, webPlays, statuses } = setup({ loadFails: true, streaming: false });
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t1', title: 't1' });
    expect(webPlays).toHaveLength(0);
    expect(statuses.some((s) => /step 2\/2/i.test(s))).toBe(true);
  });

  test('a failed load with streaming keeps the cloud fallback', async () => {
    const { actions, webPlays } = setup({ loadFails: true, streaming: true });
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t1', title: 't1' });
    expect(webPlays).toHaveLength(1);
  });

  test('checks streamingStatus before playing and does not report playing on missing streaming', async () => {
    const { actions, statuses } = setup({ loadFails: false, streaming: false });
    // When streamingStatus is checked prior to playback:
    await actions.playTrackOrContext({ trackUri: 'spotify:track:t1', title: 't1' });
    expect(statuses.some((s) => s.includes('▶ Playing:'))).toBe(false);
    expect(statuses.some((s) => /step 2\/2/i.test(s))).toBe(true);
  });
});
