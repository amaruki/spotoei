import type { ChildProcess } from 'node:child_process';
import {
  makeAuthStatus,
  makeAuthBegin,
  makeAuthBeginStreaming,
  makeAuthStreamingStatus,
  makeAuthLogout,
  makeAuthSetClientId,
  newRequestId,
  AuthStatusData,
  AuthTokenData,
  type AuthStatusDataT,
  type AuthCompletedEventDataT,
  type AuthFailedEventDataT,
  type CommandT,
} from 'spotoei-protocol';
import { createAuthLineListener, type PendingRequest } from './authInbound';
import { createAuthTokenCache } from './authTokenCache';
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

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const { child, timeoutMs = 5_000 } = options;
  const pending = new Map<string, PendingRequest>();
  const statusListeners = new Set<(status: AuthStatusDataT) => void>();
  const failureListeners = new Set<(failure: AuthFailedEventDataT) => void>();
  const completedListeners = new Set<(completed: AuthCompletedEventDataT) => void>();

  // Cached in-memory token state lives in ./authTokenCache; `drop` bumps the
  // epoch so an in-flight refresh can never repopulate a dropped cache.
  const tokenCache = createAuthTokenCache({ sendCommand, validateAuthToken });
  const dropCachedToken = tokenCache.drop;

  if (!child.stdout || !child.stdin) {
    throw new Error('child stdin/stdout must be piped to createAuthClient');
  }

  const rl = getSharedReadline(child);

  const lineListener = createAuthLineListener({
    pending,
    dropCachedToken,
    statusListeners,
    failureListeners,
    completedListeners,
  });

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
      return tokenCache.getWebToken();
    },

    clearToken(): void {
      tokenCache.clearToken();
    },

    async invalidateToken(): Promise<void> {
      return tokenCache.invalidateToken();
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
