import { afterEach, expect, it } from 'bun:test';
import { EntityManager } from '../src/entities';
import { WebApiClient } from '../src/webApi';
import { ApiError, Transport } from '../src/webApi/transport';
import { redact } from '../src/diagnostics';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('connects EntityManager new releases to the real WebApiClient endpoint', async () => {
  let path = '';
  globalThis.fetch = (async (url) => {
    path = new URL(String(url)).pathname;
    return Response.json({
      albums: {
        items: [
          {
            id: 'a',
            uri: 'spotify:album:a',
            name: 'Album',
            artists: [{ id: 'b', uri: 'spotify:artist:b', name: 'Artist' }],
          },
        ],
      },
    });
  }) as typeof fetch;
  const manager = new EntityManager(
    new WebApiClient({ tokenProvider: { getAccessToken: async () => 'fake' } }),
  );
  expect((await manager.loadNewReleases())[0]?.name).toBe('Album');
  expect(path).toBe('/v1/browse/new-releases');
});

it('does not retry a five-second rate limit after 50ms in Bun', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('Slow down', { status: 429, headers: { 'Retry-After': '5' } });
  }) as unknown as typeof fetch;
  const transport = new Transport({ getAccessToken: async () => 'fake' });
  const error = await transport.request('/me/top/tracks').catch((failure) => failure);
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) throw new Error('Expected ApiError');
  expect(error.code).toBe('API_RATE_LIMITED');
  expect(error.diagnosticId).toBeTruthy();
  expect(calls).toBe(1);
});

it('redacts token and authorization-code fields from diagnostic text', () => {
  const result = redact(
    'Bearer fake-bearer access_token=fake-access refreshToken: "fake-refresh" ?code=fake-code&state=test',
  );
  for (const secret of ['fake-bearer', 'fake-access', 'fake-refresh', 'fake-code'])
    expect(result).not.toContain(secret);
});

it('skips repeat calls to a restricted deprecated endpoint within TTL', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const transport = new Transport({ getAccessToken: async () => 'fake' });
  const first = await transport.request('/browse/new-releases', { limit: 6 }).catch((e) => e);
  const second = await transport.request('/browse/new-releases', { limit: 6 }).catch((e) => e);
  expect(first).toBeInstanceOf(ApiError);
  expect(second).toBeInstanceOf(ApiError);
  expect(calls).toBe(1);
});

it('does not skip repeat 403s on non-deprecated endpoints', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const transport = new Transport({ getAccessToken: async () => 'fake' });
  await transport.request('/me/top/tracks', { limit: 5 }).catch(() => {});
  await transport.request('/me/top/tracks', { limit: 5 }).catch(() => {});
  expect(calls).toBe(2);
});

it('honours a persistent restriction store without any fetch', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const stored = new Map<string, number>([['/v1/recommendations', Date.now() + 60_000]]);
  const transport = new Transport({ getAccessToken: async () => 'fake' }, undefined, {
    getRestriction: (endpoint: string) => stored.get(endpoint),
    setRestriction: (endpoint: string, until: number) => {
      stored.set(endpoint, until);
    },
  });
  const error = await transport.request('/recommendations?limit=8&seed_tracks=s1').catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(calls).toBe(0);
});

it('persists newly learned restrictions to the store', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
  const stored = new Map<string, number>();
  const transport = new Transport({ getAccessToken: async () => 'fake' }, undefined, {
    getRestriction: (endpoint: string) => stored.get(endpoint),
    setRestriction: (endpoint: string, until: number) => {
      stored.set(endpoint, until);
    },
  });
  await transport.request('/browse/new-releases', { limit: 6 }).catch(() => {});
  const until = stored.get('/v1/browse/new-releases');
  expect(until).toBeDefined();
  expect(until ?? 0).toBeGreaterThan(Date.now());
});

it('treats the bare browse-categories list as a deprecated endpoint', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const transport = new Transport({ getAccessToken: async () => 'fake' });
  const first = await transport.request('/browse/categories', { locale: 'en_US' }).catch((e) => e);
  const second = await transport.request('/browse/categories', { locale: 'en_US' }).catch((e) => e);
  expect(first).toBeInstanceOf(ApiError);
  expect(second).toBeInstanceOf(ApiError);
  expect(calls).toBe(1);
});
