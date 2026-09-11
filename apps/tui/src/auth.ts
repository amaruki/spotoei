import type { ChildProcess } from 'node:child_process';
import {
  makeAuthStatus,
  makeAuthBegin,
  makeAuthBeginStreaming,
  makeAuthStreamingStatus,
  makeAuthLogout,
  makeAuthGetWebToken,
  makeAuthInvalidateToken,
  makeAuthSetClientId,
  newRequestId,
  AuthStatusData,
  AuthTokenData,
  AuthCompletedEventData,
  AuthFailedEventData,
  type AuthStatusDataT,
  type AuthTokenDataT,
  type AuthCompletedEventDataT,
  type AuthFailedEventDataT,
  type CommandT,
  type InboundT,
  parseInbound,
} from 'spotoei-protocol';
import { getSharedReadline } from './player';

const validateAuthStatus = (data: unknown) => {
  const result = AuthStatusData.safeParse(data);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, error: new Error(`invalid auth status: ${result.error.message}`) };
};
const validateAuthToken = (data: unknown) => {
  const result = AuthTokenData.safeParse(data);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, error: new Error(`invalid auth token: ${result.error.message}`) };
};
export interface AuthClient {
  status(): Promise<AuthStatusDataT>;
  begin(scopes?: string[]): Promise<AuthStatusDataT>;
  beginStreaming(): Promise<AuthStatusDataT>;
  streamingStatus(): Promise<boolean>;
  logout(): Promise<AuthStatusDataT>;
  setClientId(clientId: string): Promise<void>;
  getWebToken(): Promise<string>;
  clearToken(): void;
  // Drop the cached token on both sides of the IPC boundary so the next
  // getWebToken() is forced to refresh instead of re-serving the token the
  // Spotify API just rejected with HTTP 401.
  invalidateToken(): Promise<void>;
  onStatusChange(listener: (status: AuthStatusDataT) => void): () => void;
  onAuthFailure(listener: (failure: AuthFailedEventDataT) => void): () => void;
  onAuthCompleted(listener: (completed: AuthCompletedEventDataT) => void): () => void;
  close(): void;
}

export interface AuthClientOptions {
  child: ChildProcess;
  // Timeout for command replies in ms. Default: 5000ms.
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const { child, timeoutMs = 5_000 } = options;
  const pending = new Map<string, PendingRequest>();
  const statusListeners = new Set<(status: AuthStatusDataT) => void>();
  const failureListeners = new Set<(failure: AuthFailedEventDataT) => void>();
  const completedListeners = new Set<(completed: AuthCompletedEventDataT) => void>();

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

  if (!child.stdout || !child.stdin) {
    throw new Error('child stdin/stdout must be piped to createAuthClient');
  }

  const rl = getSharedReadline(child);

  const lineListener = (line: string): void => {
    const parsed = parseInbound(line);
    if (!parsed.ok) {
      return;
    }
    const msg: InboundT = parsed.value;

    if (msg.type === 'response') {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) {
          p.resolve(msg.data);
        } else {
          const err = msg.error;
          const code = err ? err.code : 'UNKNOWN';
          const message = err ? err.message : 'unknown error';
          p.reject(new Error(`${code}: ${message}`));
        }
      }
    } else if (msg.type === 'event') {
      if (msg.event === 'auth.changed') {
        const res = AuthStatusData.safeParse(msg.data);
        if (res.success) {
          if (
            res.data.state === 'unauthenticated' ||
            res.data.state === 'refresh-failed' ||
            res.data.state === 'authenticating'
          ) {
            dropCachedToken();
          }
          for (const l of statusListeners) {
            try {
              l(res.data);
            } catch {
              // Ignore subscriber errors.
            }
          }
        }
      } else if (msg.event === 'auth.failed') {
        dropCachedToken();
        const res = AuthFailedEventData.safeParse(msg.data);
        if (res.success) {
          for (const l of failureListeners) {
            try {
              l(res.data);
            } catch {
              // Ignore subscriber errors.
            }
          }
        }
      } else if (msg.event === 'auth.completed') {
        const res = AuthCompletedEventData.safeParse(msg.data);
        if (res.success) {
          for (const l of completedListeners) {
            try {
              l(res.data);
            } catch {
              // Ignore subscriber errors.
            }
          }
        }
      }
    }
  };

  rl.on('line', lineListener);

  function sendCommand<T>(
    cmd: CommandT,
    validate: (data: unknown) => { ok: true; value: T } | { ok: false; error: Error },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(cmd.id);
        reject(new Error(`timeout waiting for response to ${cmd.command}`));
      }, timeoutMs);

      pending.set(cmd.id, {
        resolve: (val) => {
          const result = validate(val);
          if (result.ok) {
            resolve(result.value);
          } else {
            reject(result.error);
          }
        },
        reject,
        timer,
      });

      const line = JSON.stringify(cmd) + '\n';
      if (!child.stdin || !child.stdin.writable) {
        clearTimeout(timer);
        pending.delete(cmd.id);
        reject(new Error('player stdin not writable'));
        return;
      }
      child.stdin.write(line, (err) => {
        if (err) {
          pending.delete(cmd.id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  return {
    async status(): Promise<AuthStatusDataT> {
      const id = newRequestId();
      const cmd = makeAuthStatus(id);
      return sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
    },
    async begin(scopes?: string[]): Promise<AuthStatusDataT> {
      // A login may belong to another account: drop any token the previous
      // identity still has in flight before the flow starts.
      dropCachedToken();
      const id = newRequestId();
      const cmd = makeAuthBegin(id, scopes);
      const res = await sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
      // Invalidate anything that raced the command itself.
      dropCachedToken();
      return res;
    },
    async beginStreaming(): Promise<AuthStatusDataT> {
      const id = newRequestId();
      const cmd = makeAuthBeginStreaming(id);
      return sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
    },
    async streamingStatus(): Promise<boolean> {
      const id = newRequestId();
      const cmd = makeAuthStreamingStatus(id);
      const res = await sendCommand<{ authenticated: boolean }>(cmd, (data) => ({
        ok: true,
        value: data as { authenticated: boolean },
      }));
      return res?.authenticated ?? false;
    },
    async logout(): Promise<AuthStatusDataT> {
      dropCachedToken();
      const id = newRequestId();
      const cmd = makeAuthLogout(id);
      const res = await sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
      dropCachedToken();
      return res;
    },

    async setClientId(clientId: string): Promise<void> {
      dropCachedToken();
      const id = newRequestId();
      const cmd = makeAuthSetClientId(id, clientId);
      await sendCommand<unknown>(cmd, (data) => ({ ok: true, value: data }));
      dropCachedToken();
    },

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

    onStatusChange(listener: (status: AuthStatusDataT) => void): () => void {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    onAuthFailure(listener: (failure: AuthFailedEventDataT) => void): () => void {
      failureListeners.add(listener);
      return () => {
        failureListeners.delete(listener);
      };
    },

    onAuthCompleted(listener: (completed: AuthCompletedEventDataT) => void): () => void {
      completedListeners.add(listener);
      return () => {
        completedListeners.delete(listener);
      };
    },

    close(): void {
      rl.off('line', lineListener);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('auth client closed'));
      }
      pending.clear();
      statusListeners.clear();
      failureListeners.clear();
      completedListeners.clear();
    },
  };
}
