import { describe, expect, test } from 'bun:test';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { createAuthClient } from '../src/auth';
import { ApiError, Transport } from '../src/webApi/transport';

// Guards for the Spotify login session shared by the terminal UI and the
// background player process.
//
// Background: every Spotify API call carries an access token that expires
// after about an hour. When Spotify rejects a token (HTTP 401), the app must
// throw the rejected token away on BOTH sides of the UI/player boundary and
// fetch a fresh one before retrying. These tests lock that contract in:
// reusing a rejected token turns one expired token into a wall of
// AUTH_EXPIRED errors instead of a silent recovery.

describe('spotify session', () => {
  test('a rejected token is replaced, not reused, after invalidation', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin, {
      SPOTOEI_MOCK_AUTH: '1',
      SPOTOEI_MOCK_ACCOUNT_ID: 'regression-user',
      SPOTOEI_MOCK_REFRESH_TOKEN: 'regression-refresh-token',
    });
    const auth = createAuthClient({ child: handshake.child });
    try {
      await auth.begin();
      const tokenBeforeReject = await auth.getWebToken();
      expect(tokenBeforeReject.length).toBeGreaterThan(0);
      // Simulate what happens on HTTP 401: drop the token everywhere, then
      // the next call must come back with a newly minted token.
      await auth.invalidateToken();
      const tokenAfterReject = await auth.getWebToken();
      expect(tokenAfterReject).not.toBe(tokenBeforeReject);
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('parallel token requests while refreshing share one fresh value', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin, {
      SPOTOEI_MOCK_AUTH: '1',
      SPOTOEI_MOCK_ACCOUNT_ID: 'regression-user',
    });
    const auth = createAuthClient({ child: handshake.child });
    try {
      await auth.begin();
      await auth.invalidateToken();
      const tokens = await Promise.all([
        auth.getWebToken(),
        auth.getWebToken(),
        auth.getWebToken(),
      ]);
      for (const t of tokens) expect(t).toBe(tokens[0]);
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('an HTTP 401 triggers one invalidation and then retries with a new token', async () => {
    let calls = 0;
    let invalidated = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'Bad token' } }), {
          status: 401,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      let tokenCalls = 0;
      const transport = new Transport({
        getAccessToken: async () => {
          tokenCalls += 1;
          return tokenCalls === 1 ? 'stale-token' : 'fresh-token';
        },
        invalidateToken: () => {
          invalidated += 1;
        },
      });
      const res = await transport.request('/v1/regression-retry');
      expect(res).toMatchObject({ ok: true });
      expect(invalidated).toBe(1);
      expect(tokenCalls).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('a retry that is rejected again surfaces AUTH_EXPIRED instead of looping', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Bad token' } }), {
        status: 401,
      })) as unknown as typeof fetch;
    try {
      const transport = new Transport({
        getAccessToken: async () => 'always-bad',
        invalidateToken: () => {},
      });
      const err = await transport.request('/v1/regression-expired').catch((e) => e);
      expect(err instanceof ApiError).toBe(true);
      expect((err as ApiError).code).toBe('AUTH_EXPIRED');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
