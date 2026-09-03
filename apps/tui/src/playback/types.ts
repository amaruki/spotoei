import type { ChildProcess } from 'node:child_process';
import type {
  PlaybackChangedDataT,
  PlaybackPositionDataT,
} from 'spotoei-protocol';

export interface PlaybackClient {
  status(): Promise<PlaybackChangedDataT>;
  load(opts: {
    contextUri?: string;
    trackUri?: string;
    positionMs?: number;
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

export interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
