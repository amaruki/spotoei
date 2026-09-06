import { describe, expect, it } from 'bun:test';
import {
  preserveRefreshToken,
  mergeTokenRefresh,
  Transport,
} from '../src/webApi';

describe('Token Refresh Persistence (#1040 parity)', () => {
  it('preserves existing refresh_token when refreshed token omits refresh_token', () => {
    const existingRefreshToken = 'original-secret-refresh-token';

    // Refresh response only returns new access_token, refresh_token is undefined
    const responseWithoutRefresh = {
      access_token: 'new-access-token-123',
      expires_in: 3600,
    };

    const preserved = preserveRefreshToken(existingRefreshToken, responseWithoutRefresh);
    expect(preserved).toBe(existingRefreshToken);

    const merged = mergeTokenRefresh(existingRefreshToken, responseWithoutRefresh);
    expect(merged.access_token).toBe('new-access-token-123');
    expect(merged.refresh_token).toBe(existingRefreshToken);
  });

  it('preserves existing refresh_token when refreshed token has null or empty string', () => {
    const existingRefreshToken = 'original-secret-refresh-token';

    const responseWithNull = {
      access_token: 'new-access-token-456',
      refresh_token: null as string | null,
      expires_in: 3600,
    };

    const preserved = preserveRefreshToken(existingRefreshToken, responseWithNull);
    expect(preserved).toBe(existingRefreshToken);

    const merged = mergeTokenRefresh(existingRefreshToken, responseWithNull);
    expect(merged.refresh_token).toBe(existingRefreshToken);

    const responseWithEmpty = {
      accessToken: 'new-access-token-789',
      refreshToken: '',
      expiresAt: Date.now() + 3600000,
    };
    const mergedEmpty = mergeTokenRefresh({ refreshToken: existingRefreshToken }, responseWithEmpty);
    expect(mergedEmpty.refreshToken).toBe(existingRefreshToken);
  });

  it('updates refresh_token when response provides a new non-empty refresh_token', () => {
    const existingRefreshToken = 'original-secret-refresh-token';
    const newRefreshToken = 'rotated-new-refresh-token';

    const responseWithRotated = {
      access_token: 'new-access-token-999',
      refresh_token: newRefreshToken,
      expires_in: 3600,
    };

    const preserved = preserveRefreshToken(existingRefreshToken, responseWithRotated);
    expect(preserved).toBe(newRefreshToken);

    const merged = mergeTokenRefresh(existingRefreshToken, responseWithRotated);
    expect(merged.refresh_token).toBe(newRefreshToken);
  });

  it('manages refresh token lifecycle on Transport', () => {
    let currentStoredToken: string | undefined;
    const mockTokenProvider = {
      async getAccessToken() {
        return 'mock-access';
      },
      getRefreshToken() {
        return currentStoredToken;
      },
      setRefreshToken(token?: string | null) {
        currentStoredToken = token ?? undefined;
      },
    };

    const transport = new Transport(mockTokenProvider);
    transport.setRefreshToken('init-refresh-tok');
    expect(transport.getRefreshToken()).toBe('init-refresh-tok');
    expect(currentStoredToken).toBe('init-refresh-tok');

    // Simulate token refresh response without refresh_token
    const refreshed = transport.handleTokenRefresh({
      access_token: 'second-access-tok',
      expires_in: 3600,
    }) as { access_token: string; refresh_token?: string; expires_in: number };

    expect(refreshed.access_token).toBe('second-access-tok');
    expect(refreshed.refresh_token).toBe('init-refresh-tok');
    expect(transport.getRefreshToken()).toBe('init-refresh-tok');
    expect(currentStoredToken).toBe('init-refresh-tok');
  });
});
