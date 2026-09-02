import {
  PlaybackChangedData,
  PlaybackPositionData,
  makePlaybackLoad,
  makePlaybackNext,
  makePlaybackPause,
  makePlaybackPlay,
  makePlaybackPrevious,
  makePlaybackSeek,
  makePlaybackSetAutoplay,
  makePlaybackSetRepeat,
  makePlaybackSetShuffle,
  makePlaybackSetVolume,
  makePlaybackStatus,
  makePlaybackToggle,
  newRequestId,
  type PlaybackChangedDataT,
  type PlaybackPositionDataT,
  type CommandT,
  type InboundT,
  parseInbound,
} from 'spotoei-protocol';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface PlaybackClient {
  status(): Promise<PlaybackChangedDataT>;
  load(opts: {
    contextUri?: string;
    trackUri?: string;
    autoplay?: boolean;
  }): Promise<PlaybackChangedDataT>;
  play(): Promise<PlaybackChangedDataT>;
  pause(): Promise<PlaybackChangedDataT>;
  toggle(): Promise<PlaybackChangedDataT>;
  next(): Promise<PlaybackChangedDataT>;
  previous(): Promise<PlaybackChangedDataT>;
  seek(positionMs: number): Promise<PlaybackChangedDataT>;
  setVolume(volume: number): Promise<PlaybackChangedDataT>;
  setShuffle(shuffle: boolean): Promise<PlaybackChangedDataT>;
  setRepeat(repeat: 'off' | 'context' | 'track'): Promise<PlaybackChangedDataT>;
  setAutoplay(autoplay: boolean): Promise<PlaybackChangedDataT>;
  snapshot(): PlaybackChangedDataT | null;
  onChange(listener: (snap: PlaybackChangedDataT) => void): () => void;
  onPosition(listener: (pos: PlaybackPositionDataT) => void): () => void;
  close(): void;
}

export interface PlaybackClientOptions {
  child: ChildProcess;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createPlaybackClient(
  options: PlaybackClientOptions,
): PlaybackClient {
  const { child, timeoutMs = 5_000 } = options;
  const pending = new Map<string, PendingRequest>();
  const changeListeners = new Set<(s: PlaybackChangedDataT) => void>();
  const positionListeners = new Set<(p: PlaybackPositionDataT) => void>();

  let lastSnapshot: PlaybackChangedDataT | null = null;

  if (!child.stdout || !child.stdin) {
    throw new Error('child stdin/stdout must be piped to createPlaybackClient');
  }

  const rl = createInterface({ input: child.stdout });

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
          p.reject(
            new Error(
              `${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`,
            ),
          );
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

  function sendCommand<T>(cmd: CommandT): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(cmd.id);
        reject(
          new Error(`timeout waiting for response to ${cmd.command}`),
        );
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
    async status(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackStatus(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async load(opts): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackLoad(id, opts);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async play(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackPlay(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async pause(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackPause(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async toggle(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackToggle(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async next(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackNext(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async previous(): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackPrevious(id);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async seek(positionMs): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackSeek(id, positionMs);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async setVolume(volume): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackSetVolume(id, volume);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async setShuffle(shuffle): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackSetShuffle(id, shuffle);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async setRepeat(repeat): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackSetRepeat(id, repeat);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    async setAutoplay(autoplay): Promise<PlaybackChangedDataT> {
      const id = newRequestId();
      const cmd = makePlaybackSetAutoplay(id, autoplay);
      const data = await sendCommand<PlaybackChangedDataT>(cmd);
      lastSnapshot = data;
      return data;
    },

    snapshot(): PlaybackChangedDataT | null {
      return lastSnapshot;
    },

    onChange(listener): () => void {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    onPosition(listener): () => void {
      positionListeners.add(listener);
      return () => {
        positionListeners.delete(listener);
      };
    },

    close(): void {
      rl.off('line', lineListener);
      rl.close();
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
