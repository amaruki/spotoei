import { describe, expect, test } from 'bun:test';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { createAuthClient } from '../src/auth';

describe('auth integration with player sidecar', () => {
  test('fresh player reports unauthenticated state', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const auth = createAuthClient({ child: handshake.child });

    try {
      const status = await auth.status();
      expect(status.v).toBe(1);
      expect(status.state).toBe('unauthenticated');
      expect(status.accountId).toBeNull();
      expect(status.accessTokenExpiresAt).toBeNull();
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('mock auth flow achieves authenticated state and persists account id', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin, {
      SPOTOEI_MOCK_AUTH: '1',
      SPOTOEI_MOCK_ACCOUNT_ID: 'test-user-42',
      SPOTOEI_MOCK_REFRESH_TOKEN: 'mock-refresh-token-xyz',
    });
    const auth = createAuthClient({ child: handshake.child });

    try {
      const beginRes = await auth.begin();
      expect(beginRes.state).toBe('authenticated');
      expect(beginRes.accountId).toBe('test-user-42');

      const status = await auth.status();
      expect(status.state).toBe('authenticated');
      expect(status.accountId).toBe('test-user-42');

      // Fetch web token.
      const token = await auth.getWebToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // Concurrent token requests return the same token value.
      const [t1, t2] = await Promise.all([auth.getWebToken(), auth.getWebToken()]);
      expect(t1).toBe(token);
      expect(t2).toBe(token);

      // Logout returns state to unauthenticated.
      const logoutRes = await auth.logout();
      expect(logoutRes.state).toBe('unauthenticated');
      expect(logoutRes.accountId).toBeNull();

      const postLogout = await auth.status();
      expect(postLogout.state).toBe('unauthenticated');
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('getWebToken on unauthenticated player throws AUTH_REQUIRED', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const auth = createAuthClient({ child: handshake.child });

    try {
      await expect(auth.getWebToken()).rejects.toThrow('AUTH_REQUIRED');
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('secrets are not leaked into stderr logs', async () => {
    const bin = locatePlayer();
    const secretRefreshToken = 'SUPER_SECRET_REFRESH_TOKEN_DO_NOT_LEAK_1234567890';
    let stderrLog = '';

    const handshake = await startPlayer(bin, {
      SPOTOEI_MOCK_AUTH: '1',
      SPOTOEI_MOCK_REFRESH_TOKEN: secretRefreshToken,
    });

    handshake.child.stderr?.on('data', (chunk) => {
      stderrLog += chunk.toString();
    });

    const auth = createAuthClient({ child: handshake.child });

    try {
      await auth.begin();
      const token = await auth.getWebToken();

      // Ensure secret refresh token is NOT in stderr.
      expect(stderrLog.includes(secretRefreshToken)).toBe(false);
      // Ensure the minted access token is NOT in stderr.
      expect(stderrLog.includes(token)).toBe(false);
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });

  test('concurrent getWebToken calls coalesce into a single flight', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin, {
      SPOTOEI_MOCK_AUTH: '1',
    });
    const auth = createAuthClient({ child: handshake.child });

    try {
      await auth.begin();
      // Fire 5 concurrent getWebToken requests.
      const tokens = await Promise.all([
        auth.getWebToken(),
        auth.getWebToken(),
        auth.getWebToken(),
        auth.getWebToken(),
        auth.getWebToken(),
      ]);

      // All 5 should resolve to the exact same token value.
      for (const t of tokens) {
        expect(t).toBe(tokens[0]);
      }
    } finally {
      auth.close();
      await stopPlayer(handshake.child);
    }
  });
});
