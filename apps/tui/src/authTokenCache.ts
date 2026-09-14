// Cached web-token state machine for the auth client. Tracks the in-memory
// token, coalesces concurrent refreshes, and applies invalidation epochs so
// a refresh already on the wire can never repopulate a dropped cache.
// Extracted from auth.ts to keep the client under the 300 LoC cap.

import {
  makeAuthGetWebToken,
  makeAuthInvalidateToken,
  newRequestId,
  type AuthTokenDataT,
  type CommandT,
} from 'spotoei-protocol';

export interface AuthTokenCacheDeps {
  sendCommand<T>(
    cmd: CommandT,
    validate: (data: unknown) => { ok: true; value: T } | { ok: false; error: Error },
  ): Promise<T>;
  validateAuthToken: (
    data: unknown,
  ) => { ok: true; value: AuthTokenDataT } | { ok: false; error: Error };
}

export interface AuthTokenCache {
  // Drop the cached token and bump the epoch so an in-flight refresh can
  // never repopulate the cache.
  drop(): void;
  getWebToken(): Promise<string>;
  clearToken(): void;
  invalidateToken(): Promise<void>;
}

export function createAuthTokenCache(deps: AuthTokenCacheDeps): AuthTokenCache {
  const { sendCommand, validateAuthToken } = deps;

  // Cached in-memory token state. `tokenEpoch` is bumped whenever the cache
  // is dropped (401 invalidation, login, logout, client-ID change) so a
  // refresh already on the wire can never repopulate the cache with a token
  // minted for an identity the app has moved on from.
  let cachedToken: AuthTokenDataT | null = null;
  let refreshPromise: Promise<string | null> | null = null;
  let tokenEpoch = 0;
  // In-flight `auth.invalidate_token` command. New token fetches wait for it
  // so the player cannot be asked for a token before it drops the rejected one.
  let invalidationPromise: Promise<void> | null = null;

  const dropCachedToken = (): void => {
    cachedToken = null;
    tokenEpoch++;
  };

  return {
    drop: dropCachedToken,

    async getWebToken(): Promise<string> {
      for (let attempt = 0; attempt < 3; attempt++) {
        // An invalidation is being applied: wait for the player to drop the
        // rejected token before asking for the next one.
        if (invalidationPromise) {
          await invalidationPromise.catch(() => {});
          continue;
        }
        const now = Date.now();
        // Proactive refresh at 80% TTL. If expires in 1hr, refresh at remaining 12min.
        if (cachedToken && cachedToken.expiresAt > now + 60_000) {
          return cachedToken.accessToken;
        }

        let inFlight = refreshPromise;
        if (!inFlight) {
          const epoch = tokenEpoch;
          inFlight = (async (): Promise<string | null> => {
            try {
              const id = newRequestId();
              const cmd = makeAuthGetWebToken(id);
              const data = await sendCommand<AuthTokenDataT>(cmd, validateAuthToken);
              if (epoch !== tokenEpoch) {
                // 401 invalidation, login, or logout happened while this
                // refresh was on the wire: the value may be the rejected token
                // or belong to a previous account. Never cache it.
                return null;
              }
              const prevRefreshToken = cachedToken?.refreshToken;
              const nextRefreshToken = data.refreshToken || prevRefreshToken;
              cachedToken = {
                ...data,
                ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
              };
              return data.accessToken;
            } finally {
              if (refreshPromise === inFlight) refreshPromise = null;
            }
          })();
          refreshPromise = inFlight;
        }
        const token = await inFlight;
        if (token !== null) return token;
        // Superseded: loop and fetch for the current epoch.
      }
      throw new Error('token refresh superseded by a newer authentication state');
    },

    clearToken(): void {
      dropCachedToken();
    },

    async invalidateToken(): Promise<void> {
      dropCachedToken();
      if (invalidationPromise) return invalidationPromise;
      const run = (async (): Promise<void> => {
        try {
          const id = newRequestId();
          const cmd = makeAuthInvalidateToken(id);
          await sendCommand<unknown>(cmd, (data) => ({ ok: true, value: data }));
        } catch {
          // Local cache is already cleared; the retry's getWebToken call
          // surfaces the real error if the player is unreachable.
        } finally {
          invalidationPromise = null;
        }
      })();
      invalidationPromise = run;
      return run;
    },
  };
}
