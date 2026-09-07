import type { ChildProcess } from 'node:child_process';
import {
  makeAuthStatus,
  makeAuthBegin,
  makeAuthLogout,
  makeAuthGetWebToken,
  makeAuthInvalidateToken,
  makeAuthSetClientId,
  newRequestId,
  AuthStatusData,
  AuthTokenData,
  type AuthStatusDataT,
  type AuthTokenDataT,
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
  logout(): Promise<AuthStatusDataT>;
  setClientId(clientId: string): Promise<void>;
  getWebToken(): Promise<string>;
  clearToken(): void;
  // Drop the cached token on both sides of the IPC boundary so the next
  // getWebToken() is forced to refresh instead of re-serving the token the
  // Spotify API just rejected with HTTP 401.
  invalidateToken(): Promise<void>;
  onStatusChange(listener: (status: AuthStatusDataT) => void): () => void;
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

  // Cached in-memory token state.
  let cachedToken: AuthTokenDataT | null = null;
  let refreshPromise: Promise<string> | null = null;

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
            cachedToken = null;
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
        cachedToken = null;
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
      const id = newRequestId();
      const cmd = makeAuthBegin(id, scopes);
      const res = await sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
      // Invalidate any old in-memory token.
      cachedToken = null;
      return res;
    },

    async logout(): Promise<AuthStatusDataT> {
      const id = newRequestId();
      const cmd = makeAuthLogout(id);
      const res = await sendCommand<AuthStatusDataT>(cmd, validateAuthStatus);
      cachedToken = null;
      return res;
    },

    async setClientId(clientId: string): Promise<void> {
      const id = newRequestId();
      const cmd = makeAuthSetClientId(id, clientId);
      await sendCommand<unknown>(cmd, (data) => ({ ok: true, value: data }));
      cachedToken = null;
    },

    async getWebToken(): Promise<string> {
      const now = Date.now();
      // Proactive refresh at 80% TTL. If expires in 1hr, refresh at remaining 12min.
      if (cachedToken && cachedToken.expiresAt > now + 60_000) {
        return cachedToken.accessToken;
      }

      if (refreshPromise) {
        return refreshPromise;
      }

      refreshPromise = (async () => {
        try {
          const id = newRequestId();
          const cmd = makeAuthGetWebToken(id);
          const data = await sendCommand<AuthTokenDataT>(cmd, validateAuthToken);
          const prevRefreshToken = cachedToken?.refreshToken;
          const nextRefreshToken = data.refreshToken || prevRefreshToken;
          cachedToken = {
            ...data,
            ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
          };
          return data.accessToken;
        } finally {
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    },

    clearToken(): void {
      cachedToken = null;
    },

    async invalidateToken(): Promise<void> {
      cachedToken = null;
      try {
        const id = newRequestId();
        const cmd = makeAuthInvalidateToken(id);
        await sendCommand<unknown>(cmd, (data) => ({ ok: true, value: data }));
      } catch {
        // Local cache is already cleared; the retry's getWebToken call
        // surfaces the real error if the player is unreachable.
      }
    },

    onStatusChange(listener: (status: AuthStatusDataT) => void): () => void {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
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
    },
  };
}
