import {
  makeAuthStatus,
  makeAuthBegin,
  makeAuthLogout,
  makeAuthGetWebToken,
  newRequestId,
  type AuthStatusDataT,
  type AuthTokenDataT,
  type CommandT,
  type InboundT,
  parseInbound,
} from 'spotoei-protocol';
import type { ChildProcess } from 'node:child_process';
import { getSharedReadline } from './player';

export interface AuthClient {
  status(): Promise<AuthStatusDataT>;
  begin(scopes?: string[]): Promise<AuthStatusDataT>;
  logout(): Promise<AuthStatusDataT>;
  getWebToken(): Promise<string>;
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
      if (msg.event === 'auth.changed' || msg.event === 'auth.completed') {
        const data = msg.data as AuthStatusDataT;
        for (const l of statusListeners) {
          try {
            l(data);
          } catch {
            // Ignore subscriber errors.
          }
        }
      }
    }
  };

  rl.on('line', lineListener);

  function sendCommand<T>(cmd: CommandT): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(cmd.id);
        reject(new Error(`timeout waiting for response to ${cmd.command}`));
      }, timeoutMs);

      pending.set(cmd.id, {
        resolve: (val) => resolve(val as T),
        reject,
        timer,
      });

      const line = JSON.stringify(cmd) + '\n';
      child.stdin?.write(line, (err) => {
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
      return sendCommand<AuthStatusDataT>(cmd);
    },

    async begin(scopes?: string[]): Promise<AuthStatusDataT> {
      const id = newRequestId();
      const cmd = makeAuthBegin(id, scopes);
      const res = await sendCommand<AuthStatusDataT>(cmd);
      // Invalidate any old in-memory token.
      cachedToken = null;
      return res;
    },

    async logout(): Promise<AuthStatusDataT> {
      const id = newRequestId();
      const cmd = makeAuthLogout(id);
      const res = await sendCommand<AuthStatusDataT>(cmd);
      cachedToken = null;
      return res;
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
          const data = await sendCommand<AuthTokenDataT>(cmd);
          cachedToken = data;
          return data.accessToken;
        } finally {
          refreshPromise = null;
        }
      })();

      return refreshPromise;
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
