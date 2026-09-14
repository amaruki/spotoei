// Refresh-token preservation helpers for OAuth token refresh responses.

import type { TokenPayload } from './types';

/**
 * Preserves previous refresh_token when a token refresh response returns
 * a new access_token without a new refresh_token (#1040 parity).
 */
export function preserveRefreshToken(
  previousRefreshToken: string | null | undefined,
  refreshedToken:
    | Record<string, unknown>
    | { refresh_token?: string | null; refreshToken?: string | null }
    | null
    | undefined,
): string | undefined {
  if (!refreshedToken || typeof refreshedToken !== 'object') {
    return previousRefreshToken ?? undefined;
  }
  const next =
    'refresh_token' in refreshedToken && typeof refreshedToken.refresh_token === 'string'
      ? refreshedToken.refresh_token
      : 'refreshToken' in refreshedToken && typeof refreshedToken.refreshToken === 'string'
        ? refreshedToken.refreshToken
        : undefined;
  if (next && next.trim().length > 0) {
    return next;
  }
  return previousRefreshToken ?? undefined;
}

/**
 * Merges a refresh token response into existing credentials, preserving the existing
 * refresh_token if the response omitted or nullified it (#1040 parity).
 */
export function mergeTokenRefresh<T extends Record<string, unknown>>(
  current: TokenPayload | string | null | undefined,
  refreshed: T,
): T & { refresh_token?: string; refreshToken?: string } {
  const prevRefresh =
    typeof current === 'string' ? current : (current?.refreshToken ?? current?.refresh_token);

  const ref = refreshed as Record<string, unknown>;
  const nextRefresh = ref.refresh_token ?? ref.refreshToken;
  if (!nextRefresh || (typeof nextRefresh === 'string' && !nextRefresh.trim())) {
    if (prevRefresh) {
      if ('refresh_token' in ref || !('refreshToken' in ref)) {
        return {
          ...refreshed,
          refresh_token: prevRefresh,
        };
      } else {
        return {
          ...refreshed,
          refreshToken: prevRefresh,
        };
      }
    }
  }
  return refreshed;
}
