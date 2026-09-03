import type { ChildProcess } from 'node:child_process';
import {
  PlaybackChangedData,
  PlaybackPositionData,
  parseInbound,
  type CommandT,
  type InboundT,
  type PlaybackChangedDataT,
  type PlaybackPositionDataT,
} from 'spotoei-protocol';
import { getSharedReadline } from '../player';
import type { PendingRequest } from './types';
import type { Validator } from './validator';

const MAX_PENDING = 32;

export interface PlaybackTransport {
  sendCommand<T>(cmd: CommandT, validate: Validator<T>): Promise<T>;
  getLastSnapshot(): PlaybackChangedDataT | null;
  setLastSnapshot(snap: PlaybackChangedDataT): void;
  addChangeListener(listener: (s: PlaybackChangedDataT) => void): () => void;
  addPositionListener(listener: (p: PlaybackPositionDataT) => void): () => void;
  close(): void;
}

export function createPlaybackTransport(
  child: ChildProcess,
  timeoutMs = 5_000,
): PlaybackTransport {
  if (!child.stdout || !child.stdin) {
    throw new Error('child stdin/stdout must be piped to createPlaybackClient');
  }

  const pending = new Map<string, PendingRequest>();
  const changeListeners = new Set<(s: PlaybackChangedDataT) => void>();
  const positionListeners = new Set<(p: PlaybackPositionDataT) => void>();
  let lastSnapshot: PlaybackChangedDataT | null = null;

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
          p.reject(new Error(`${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`));
        }
      }
      return;
    }

    if (msg.type === 'event') {
      if (msg.event === 'playback.changed') {
        const result = PlaybackChangedData.safeParse(msg.data);
        if (result.success) {
          lastSnapshot = result.data;
          for (const l of changeListeners) {
            try {
              l(result.data);
            } catch {
              // ignore subscriber errors
            }
          }
        }
      } else if (msg.event === 'playback.position') {
        const result = PlaybackPositionData.safeParse(msg.data);
        if (result.success) {
          for (const l of positionListeners) {
            try {
              l(result.data);
            } catch {
              // ignore subscriber errors
            }
          }
        }
      }
    }
  };

  rl.on('line', lineListener);

  function drainPending(err: Error) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  if (child.stdin) {
    child.stdin.on('error', (err) => {
      drainPending(err instanceof Error ? err : new Error(String(err)));
    });
    child.stdin.on('end', () => {
      drainPending(new Error('playback client stdin closed'));
    });
  }
  child.on('close', () => {
    drainPending(new Error('playback client child process closed'));
  });

  function sendCommand<T>(cmd: CommandT, validate: Validator<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (pending.size >= MAX_PENDING) {
        reject(new Error(`pending command queue full (${MAX_PENDING})`));
        return;
      }
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
    sendCommand,
    getLastSnapshot: () => lastSnapshot,
    setLastSnapshot: (snap) => {
      lastSnapshot = snap;
    },
    addChangeListener: (listener) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    addPositionListener: (listener) => {
      positionListeners.add(listener);
      return () => {
        positionListeners.delete(listener);
      };
    },
    close: () => {
      rl.off('line', lineListener);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('playback client closed'));
      }
      pending.clear();
      changeListeners.clear();
      positionListeners.clear();
    },
  };
}
