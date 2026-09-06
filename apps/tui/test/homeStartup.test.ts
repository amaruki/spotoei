import { expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createUiCore, type Ui } from '../src/ui';
import { initUi } from '../src/main/ui';
import type { AppContext } from '../src/main/types';
import { initialHomeTabs } from '../src/home/tabs';
import { cancelHomeLoad } from '../src/main/homeLoad';

it('loads Home during authenticated startup while the outer UI handle is still null', async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 120,
    height: 40,
  });
  let ui: Ui | null = null;
  const pending = Promise.withResolvers<never[]>();
  let calls = 0;
  const ctx = {
    getUi: () => ui,
    quit: async () => {},
    state: {
      homeTabs: initialHomeTabs(),
      currentInfo: {
        protocol: 1,
        playerVersion: 'test',
        capabilities: [],
        auth: {
          v: 1,
          state: 'authenticated',
          scopes: [],
          storage: 'memory',
          accountId: 'test',
          authUrl: null,
          accessTokenExpiresAt: null,
        },
        visualizer: { mode: 'spectrum', fps: 30 },
      },
    },
    clients: {
      homeManager: {
        loadForYou: async () => {
          calls++;
          return {
            topTracks: [
              {
                id: 't',
                uri: 'spotify:track:t',
                name: 'Startup track',
                artists: [],
                durationMs: 1000,
              },
            ],
            topArtists: [],
            range: 'medium_term',
          };
        },
        loadRecentlyPlayed: async () => ({ items: [] }),
      },
      entityManager: {
        loadNewReleases: () => pending.promise,
        loadRecommendations: async () => [],
      },
    },
  } as unknown as AppContext;
  try {
    ui = await initUi(
      ctx,
      { handleKey: () => {} } as unknown as Parameters<typeof initUi>[1],
      async (state, opts) => createUiCore(renderer, state, opts),
    );
    await renderOnce();
    expect(calls).toBe(1);
    expect(captureCharFrame()).toContain('Startup track');
  } finally {
    cancelHomeLoad(ctx.state);
    pending.resolve([]);
    await ui?.shutdown();
  }
});
