import { describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
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

interface FakeCommand {
  id: string;
  command: string;
}

function createFakePlayer() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const commands: FakeCommand[] = [];
  let buffered = '';
  stdin.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) commands.push(JSON.parse(line) as FakeCommand);
      newline = buffered.indexOf('\n');
    }
  });
  const respond = (id: string, data: unknown): void => {
    stdout.write(`${JSON.stringify({ v: 1, type: 'response', id, ok: true, data })}\n`);
  };
  const tokenCommands = (): FakeCommand[] =>
    commands.filter((cmd) => cmd.command === 'auth.get_web_token');
  const tokenCommand = (index: number): FakeCommand => {
    const command = tokenCommands()[index];
    if (!command) throw new Error(`missing auth.get_web_token command #${index}`);
    return command;
  };
  return {
    child: { stdout, stdin } as unknown as ChildProcess,
    commands,
    respond,
    tokenCommands,
    tokenCommand,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('token refresh generations', () => {
  test('a refresh that resolves after invalidation is discarded and refetched', async () => {
    const player = createFakePlayer();
    const auth = createAuthClient({ child: player.child });
    try {
      const pending = auth.getWebToken();
      await waitFor(() => player.tokenCommands().length === 1);
      const stale = player.tokenCommand(0);

      // HTTP 401 path: drop the token everywhere, then retry.
      const invalidating = auth.invalidateToken();
      await waitFor(() => player.commands.some((cmd) => cmd.command === 'auth.invalidate_token'));
      const invalidate = player.commands.find(
        (cmd) => cmd.command === 'auth.invalidate_token',
      ) as FakeCommand;
      player.respond(invalidate.id, { ok: true });
      await invalidating;

      // The refresh that was already on the wire resolves with the token the
      // API just rejected. It must not be cached or returned.
      player.respond(stale.id, {
        accessToken: 'stale-token',
        expiresAt: Date.now() + 3600_000,
      });
      await waitFor(() => player.tokenCommands().length === 2);
      const retry = player.tokenCommand(1);
      player.respond(retry.id, {
        accessToken: 'fresh-token',
        expiresAt: Date.now() + 3600_000,
      });

      await expect(pending).resolves.toBe('fresh-token');
      // The fresh value is cached: no third command.
      await expect(auth.getWebToken()).resolves.toBe('fresh-token');
      expect(player.tokenCommands()).toHaveLength(2);
    } finally {
      auth.close();
    }
  });

  test('a login started mid-refresh discards the old session token', async () => {
    const player = createFakePlayer();
    const auth = createAuthClient({ child: player.child });
    try {
      const pending = auth.getWebToken();
      await waitFor(() => player.tokenCommands().length === 1);
      const stale = player.tokenCommand(0);

      const beginning = auth.begin();
      await waitFor(() => player.commands.some((cmd) => cmd.command === 'auth.begin'));
      const begin = player.commands.find((cmd) => cmd.command === 'auth.begin') as FakeCommand;
      player.respond(begin.id, {
        v: 1,
        state: 'authenticating',
        accountId: null,
        scopes: [],
        storage: 'keyring',
        accessTokenExpiresAt: null,
        authUrl: 'http://127.0.0.1:8989/login?state=new',
        pending: true,
      });
      await beginning;

      player.respond(stale.id, {
        accessToken: 'old-account-token',
        expiresAt: Date.now() + 3600_000,
      });
      await waitFor(() => player.tokenCommands().length === 2);
      const retry = player.tokenCommand(1);
      player.respond(retry.id, {
        accessToken: 'new-account-token',
        expiresAt: Date.now() + 3600_000,
      });

      await expect(pending).resolves.toBe('new-account-token');
    } finally {
      auth.close();
    }
  });

  test('a cached token is dropped when a login begins', async () => {
    const player = createFakePlayer();
    const auth = createAuthClient({ child: player.child });
    try {
      const first = auth.getWebToken();
      await waitFor(() => player.tokenCommands().length === 1);
      player.respond(player.tokenCommand(0).id, {
        accessToken: 'cached-old',
        expiresAt: Date.now() + 3600_000,
      });
      await expect(first).resolves.toBe('cached-old');

      const beginning = auth.begin();
      await waitFor(() => player.commands.some((cmd) => cmd.command === 'auth.begin'));
      const begin = player.commands.find((cmd) => cmd.command === 'auth.begin') as FakeCommand;
      player.respond(begin.id, {
        v: 1,
        state: 'unauthenticated',
        accountId: null,
        scopes: [],
        storage: 'keyring',
        accessTokenExpiresAt: null,
        authUrl: null,
      });
      await beginning;

      const next = auth.getWebToken();
      await waitFor(() => player.tokenCommands().length === 2);
      player.respond(player.tokenCommand(1).id, {
        accessToken: 'cached-new',
        expiresAt: Date.now() + 3600_000,
      });
      await expect(next).resolves.toBe('cached-new');
    } finally {
      auth.close();
    }
  });
});
