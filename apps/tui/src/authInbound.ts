// Inbound line handling for the auth client: resolves pending command
// responses and dispatches auth events to subscribers. Extracted from
// auth.ts to keep the client under the 300 LoC cap.

import {
  AuthCompletedEventData,
  AuthFailedEventData,
  AuthStatusData,
  parseInbound,
  type AuthCompletedEventDataT,
  type AuthFailedEventDataT,
  type AuthStatusDataT,
  type InboundT,
} from 'spotoei-protocol';

export interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AuthInboundDeps {
  pending: Map<string, PendingRequest>;
  dropCachedToken: () => void;
  statusListeners: Set<(status: AuthStatusDataT) => void>;
  failureListeners: Set<(failure: AuthFailedEventDataT) => void>;
  completedListeners: Set<(completed: AuthCompletedEventDataT) => void>;
}

export function createAuthLineListener(deps: AuthInboundDeps): (line: string) => void {
  const { pending, dropCachedToken, statusListeners, failureListeners, completedListeners } = deps;

  return (line: string): void => {
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
}
