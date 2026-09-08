import { afterEach, describe, expect, test } from 'bun:test';
import { QueueManager } from '../src/queue';
import { WebApiClient } from '../src/webApi';
import { ApiError, Transport } from '../src/webApi/transport';
import { createEnrichment } from '../src/main/enrich';
import { createQueueActions } from '../src/main/queue';
import type { AppContext } from '../src/main/types';
import type { QueueSnapshotT } from 'spotoei-protocol';

// When Spotify rate-limits the app, the client must back off instead of
// hammering the same endpoints: every repeated request both spams the log
// and extends Spotify's ban. These tests lock in fail-fast behavior while a
// ban is active.

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function rateLimited(seconds: string): Response {
  return new Response('Slow down', { status: 429, headers: { 'Retry-After': seconds } });
}

describe('rate-limit backoff', () => {
  test('a banned endpoint fails fast without another network call', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return rateLimited('30');
    }) as unknown as typeof fetch;
    const transport = new Transport({ getAccessToken: async () => 'fake' });
    const first = await transport.request('/me/top/tracks').catch((e) => e);
    const second = await transport.request('/me/top/tracks').catch((e) => e);
    expect(first).toBeInstanceOf(ApiError);
    expect(second).toBeInstanceOf(ApiError);
    expect((second as ApiError).code).toBe('API_RATE_LIMITED');
    expect(calls).toBe(1);
  });

  test('the backoff is per-endpoint, other routes still go out', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return rateLimited('30');
    }) as unknown as typeof fetch;
    const transport = new Transport({ getAccessToken: async () => 'fake' });
    await transport.request('/me/top/tracks').catch(() => {});
    await transport.request('/me/top/artists').catch(() => {});
    expect(calls).toBe(2);
  });

  test('queue refreshes coalesce while a recent refresh is fresh', async () => {
    let calls = 0;
    const fakeWebApi = {
      async getQueueSnapshot(): Promise<QueueSnapshotT> {
        calls++;
        return { current: null, upcoming: [], revision: 0 };
      },
    } as unknown as WebApiClient;
    const manager = new QueueManager({ webApi: fakeWebApi });
    await manager.refresh();
    await manager.refresh();
    expect(calls).toBe(1);
  });

  test('a failing artist lookup is not retried on every playback event', async () => {
    let calls = 0;
    const ctx = {
      clients: {
        webApi: {
          getArtistGenres: async (): Promise<string[]> => {
            calls++;
            throw new Error('RATE_LIMITED: 429');
          },
        },
      },
      state: { artistGenreCache: new Map<string, string>() },
      getUi: () => null,
    } as unknown as AppContext;
    const enrichment = createEnrichment(ctx);
    await enrichment.resolveTrackGenre('a1');
    await enrichment.resolveTrackGenre('a1');
    expect(calls).toBe(1);
  });

  test('rate-limited GET requests retry up to two times if wait <= 2s', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return rateLimited('1');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const transport = new Transport({ getAccessToken: async () => 'fake' });
    const res = await transport.request('/me/tracks');
    expect(res).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('mutation requests are never delayed or retried on 429', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return rateLimited('1');
    }) as unknown as typeof fetch;
    const transport = new Transport({ getAccessToken: async () => 'fake' });
    const err = await transport.request('/me/player/pause', {}, 'PUT').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('API_RATE_LIMITED');
    expect(calls).toBe(1);
  });

  test('rate-limited GET falls back to cached response gracefully', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ cached: true }), { status: 200 });
      return rateLimited('30');
    }) as unknown as typeof fetch;
    const transport = new Transport({ getAccessToken: async () => 'fake' });
    const first = await transport.request('/me/player/queue');
    expect(first).toEqual({ cached: true });

    // Second call hits 429 and returns cached data instead of throwing
    const second = await transport.request('/me/player/queue');
    expect(second).toEqual({ cached: true });
  });

  test('local playback mode does not poll queue endpoint', async () => {
    let refreshCalls = 0;
    const ctx = {
      clients: {
        queueManager: {
          refresh: async () => {
            refreshCalls++;
            return { current: null, upcoming: [], revision: 0 };
          },
          getSnapshot: () => ({ current: null, upcoming: [], revision: 0 }),
        },
      },
      state: {
        currentInfo: {
          audioConfig: { deviceMode: 'integrated' },
          playback: null,
        },
        activePlaylistTracks: [],
      },
      getUi: () => null,
    } as unknown as AppContext;
    const actions = createQueueActions(ctx);
    await actions.updateQueueView();
    expect(refreshCalls).toBe(0);
  });
});
