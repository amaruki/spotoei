import type { PlaybackChangedDataT } from 'spotoei-protocol';

export const DEFAULT_OPTIMISTIC_TTL_MS = 1500;
export const MAX_PENDING_CHANGES = 16;

export type PlaybackAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'seek'; positionMs: number }
  | { type: 'seekRelative'; offsetMs: number }
  | { type: 'next'; track?: PlaybackChangedDataT['track'] }
  | { type: 'previous'; track?: PlaybackChangedDataT['track'] }
  | { type: 'setVolume'; volume: number }
  | { type: 'toggleMute' }
  | { type: 'setShuffle'; shuffle: boolean }
  | { type: 'setRepeat'; repeat: 'off' | 'context' | 'track' }
  | { type: 'setAutoplay'; autoplay: boolean }
  | {
      type: 'load';
      opts: {
        trackUri?: string;
        contextUri?: string;
        name?: string;
        artists?: string[];
        album?: string;
        durationMs?: number;
        autoplay?: boolean;
      };
    };

export interface PendingPlaybackChange {
  id: string;
  action: PlaybackAction;
  timestamp: number;
  ttlMs: number;
  previousState: PlaybackChangedDataT | null;
  predictedState: PlaybackChangedDataT;
}

export function applyPlaybackAction(
  base: PlaybackChangedDataT,
  action: PlaybackAction,
): PlaybackChangedDataT {
  const next: PlaybackChangedDataT = {
    ...base,
    observedAtMonotonicMs: Date.now(),
  };
  switch (action.type) {
    case 'play':
      next.state = 'playing';
      break;
    case 'pause':
      next.state = 'paused';
      break;
    case 'toggle':
      next.state = base.state === 'playing' ? 'paused' : 'playing';
      break;
    case 'seek': {
      const maxDur = base.durationMs > 0 ? base.durationMs : (base.track?.durationMs ?? 0);
      next.positionMs = Math.max(
        0,
        maxDur > 0 ? Math.min(maxDur, action.positionMs) : action.positionMs,
      );
      break;
    }
    case 'seekRelative': {
      const maxDur = base.durationMs > 0 ? base.durationMs : (base.track?.durationMs ?? 0);
      const target = base.positionMs + action.offsetMs;
      next.positionMs = Math.max(0, maxDur > 0 ? Math.min(maxDur, target) : target);
      break;
    }
    case 'next':
    case 'previous':
      next.positionMs = 0;
      next.state = 'playing';
      if (action.track) {
        next.track = action.track;
        if (action.track.durationMs) next.durationMs = action.track.durationMs;
      }
      break;
    case 'setVolume':
      next.volume = Math.max(0, Math.min(1, action.volume));
      break;
    case 'toggleMute':
      next.volume = base.volume > 0 ? 0 : 0.5;
      break;
    case 'setShuffle':
      next.shuffle = action.shuffle;
      break;
    case 'setRepeat':
      next.repeat = action.repeat;
      break;
    case 'setAutoplay':
      next.autoplay = action.autoplay;
      break;
    case 'load': {
      next.positionMs = 0;
      // The backend only reports playing once librespot actually starts the
      // stream. Predicting 'playing' here would advance the progress bar
      // during session/connect time that is not playback.
      next.state = 'loading';
      if (action.opts.durationMs && action.opts.durationMs > 0) {
        next.durationMs = action.opts.durationMs;
      }
      if (action.opts.trackUri || action.opts.name) {
        next.track = {
          uri: action.opts.trackUri ?? 'spotify:track:loading',
          name: action.opts.name ?? 'Track',
          artists: action.opts.artists ?? [],
          album: action.opts.album,
          durationMs: action.opts.durationMs ?? next.durationMs,
        };
      }
      break;
    }
  }

  return next;
}

export function actionMatches(
  change: PendingPlaybackChange,
  serverState: PlaybackChangedDataT,
): boolean {
  switch (change.action.type) {
    case 'play':
      return serverState.state === 'playing';
    case 'pause':
      return serverState.state === 'paused';
    case 'toggle':
      return serverState.state === change.predictedState.state;
    case 'seek':
      return Math.abs(serverState.positionMs - change.action.positionMs) <= 2000;
    case 'seekRelative':
      return Math.abs(serverState.positionMs - change.predictedState.positionMs) <= 2000;
    case 'next':
    case 'previous':
      return (
        (serverState.track?.uri !== undefined &&
          change.previousState?.track?.uri !== undefined &&
          serverState.track.uri !== change.previousState.track.uri) ||
        serverState.positionMs === 0 ||
        serverState.state === 'playing' ||
        serverState.state === 'loading'
      );
    case 'setVolume':
      return Math.abs(serverState.volume - change.action.volume) <= 0.05;
    case 'toggleMute':
      return change.predictedState.volume === 0 ? serverState.volume === 0 : serverState.volume > 0;
    case 'setShuffle':
      return serverState.shuffle === change.action.shuffle;
    case 'setRepeat':
      return serverState.repeat === change.action.repeat;
    case 'setAutoplay':
      return serverState.autoplay === change.action.autoplay;
    case 'load':
      return !change.action.opts.trackUri || serverState.track?.uri === change.action.opts.trackUri;
    default:
      return false;
  }
}
