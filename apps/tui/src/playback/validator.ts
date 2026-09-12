import { PlaybackChangedData, type PlaybackChangedDataT, type PlaybackPositionDataT } from 'spotoei-protocol';

export const validatePlaybackChanged = (data: unknown) => {
  const result = PlaybackChangedData.safeParse(data);
  return result.success
    ? { ok: true as const, value: result.data }
    : {
        ok: false as const,
        error: new Error(`invalid playback state: ${result.error.message}`),
      };
};

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: Error };

export type Validator<T> = (data: unknown) => ValidateResult<T>;

export const validatePlaybackChangedT: Validator<PlaybackChangedDataT> = (data) =>
  validatePlaybackChanged(data) as ValidateResult<PlaybackChangedDataT>;

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

export class OptimisticPlaybackStateMachine {
  private authoritativeState: PlaybackChangedDataT | null = null;
  private optimisticState: PlaybackChangedDataT | null = null;
  private pendingChanges: PendingPlaybackChange[] = [];
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_OPTIMISTIC_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private createDefaultState(): PlaybackChangedDataT {
    return {
      revision: 0,
      state: 'idle',
      track: null,
      positionMs: 0,
      durationMs: 0,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
      autoplay: false,
      observedAtMonotonicMs: Date.now(),
    };
  }

  private purgeExpired(now: number): void {
    const initialLen = this.pendingChanges.length;
    if (initialLen === 0) return;
    this.pendingChanges = this.pendingChanges.filter((c) => now - c.timestamp < c.ttlMs);
    if (this.pendingChanges.length === initialLen) return;

    if (this.pendingChanges.length === 0) {
      this.optimisticState = this.authoritativeState;
    } else {
      let st = this.authoritativeState ?? this.pendingChanges[0]?.previousState ?? this.createDefaultState();
      for (const pending of this.pendingChanges) {
        pending.previousState = st;
        st = this.applyActionToState(st, pending.action);
        pending.predictedState = st;
      }
      this.optimisticState = st;
    }
  }

  public applyActionToState(
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
        const maxDur = base.durationMs > 0 ? base.durationMs : base.track?.durationMs ?? 0;
        next.positionMs = Math.max(0, maxDur > 0 ? Math.min(maxDur, action.positionMs) : action.positionMs);
        break;
      }
      case 'seekRelative': {
        const maxDur = base.durationMs > 0 ? base.durationMs : base.track?.durationMs ?? 0;
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

  private matches(change: PendingPlaybackChange, serverState: PlaybackChangedDataT): boolean {
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
        return (
          !change.action.opts.trackUri ||
          serverState.track?.uri === change.action.opts.trackUri
        );
      default:
        return false;
    }
  }

  public applyOptimistic(
    action: PlaybackAction,
    id: string,
    baseState?: PlaybackChangedDataT | null,
    now = Date.now(),
  ): PlaybackChangedDataT {
    this.purgeExpired(now);
    const base = baseState ?? this.getEffectiveState(now) ?? this.createDefaultState();
    const predicted = this.applyActionToState(base, action);

    this.pendingChanges.push({
      id,
      action,
      timestamp: now,
      ttlMs: this.ttlMs,
      previousState: base,
      predictedState: predicted,
    });
    if (this.pendingChanges.length > MAX_PENDING_CHANGES) {
      this.pendingChanges.splice(0, this.pendingChanges.length - MAX_PENDING_CHANGES);
    }
    this.optimisticState = predicted;
    return predicted;
  }

  public rollback(id: string): PlaybackChangedDataT | null {
    const now = Date.now();
    const idx = this.pendingChanges.findIndex((c) => c.id === id);
    if (idx === -1) {
      return this.getEffectiveState(now);
    }
    const removed = this.pendingChanges.splice(idx, 1)[0];
    if (!removed) {
      return this.getEffectiveState(now);
    }
    this.purgeExpired(now);
    if (this.pendingChanges.length === 0) {
      this.optimisticState = this.authoritativeState ?? removed.previousState;
    } else {
      let st =
        this.authoritativeState ??
        (idx === 0 ? removed.previousState : this.pendingChanges[0]?.previousState) ??
        this.createDefaultState();
      for (const pending of this.pendingChanges) {
        pending.previousState = st;
        st = this.applyActionToState(st, pending.action);
        pending.predictedState = st;
      }
      this.optimisticState = st;
    }
    return this.getEffectiveState(now);
  }

  public reconcile(serverState: PlaybackChangedDataT, now = Date.now()): PlaybackChangedDataT {
    const isStale =
      this.authoritativeState !== null &&
      ((serverState.revision !== undefined &&
        this.authoritativeState.revision !== undefined &&
        serverState.revision < this.authoritativeState.revision) ||
       (serverState.revision === this.authoritativeState.revision &&
        serverState.observedAtMonotonicMs !== undefined &&
        this.authoritativeState.observedAtMonotonicMs !== undefined &&
        serverState.observedAtMonotonicMs < this.authoritativeState.observedAtMonotonicMs));

    if (!isStale) {
      this.authoritativeState = serverState;
    }

    this.purgeExpired(now);

    let lastMatchIdx = -1;
    for (let i = 0; i < this.pendingChanges.length; i++) {
      const change = this.pendingChanges[i];
      if (!change) continue;
      const serverOlderThanChange =
        change.previousState?.revision !== undefined &&
        serverState.revision !== undefined &&
        serverState.revision < change.previousState.revision;

      if (!serverOlderThanChange && this.matches(change, serverState)) {
        lastMatchIdx = i;
      }
    }

    if (lastMatchIdx !== -1) {
      this.pendingChanges.splice(0, lastMatchIdx + 1);
    }

    const baseForReplay = this.authoritativeState ?? serverState;
    if (this.pendingChanges.length === 0) {
      this.optimisticState = baseForReplay;
      return baseForReplay;
    }

    let st = baseForReplay;
    for (const pending of this.pendingChanges) {
      pending.previousState = st;
      st = this.applyActionToState(st, pending.action);
      pending.predictedState = st;
    }
    this.optimisticState = st;
    return st;
  }

  public reconcileWebApiResponse(
    webApiState: Record<string, unknown> | null,
    now = Date.now(),
  ): PlaybackChangedDataT | null {
    if (!webApiState) return this.getEffectiveState(now);
    const isPlaying = Boolean(webApiState.is_playing);
    const progressMs = typeof webApiState.progress_ms === 'number' ? webApiState.progress_ms : 0;
    const item = webApiState.item as Record<string, unknown> | undefined;
    const durMs = typeof item?.duration_ms === 'number' ? item.duration_ms : 0;
    const current = this.authoritativeState ?? this.createDefaultState();

    const converted: PlaybackChangedDataT = {
      ...current,
      state: isPlaying ? 'playing' : 'paused',
      positionMs: progressMs,
      durationMs: durMs > 0 ? durMs : current.durationMs,
      shuffle: Boolean(webApiState.shuffle_state),
      repeat: (webApiState.repeat_state as 'off' | 'context' | 'track') ?? current.repeat,
      observedAtMonotonicMs: now,
    };
    if (item && typeof item.name === 'string' && typeof item.uri === 'string') {
      const artists = Array.isArray(item.artists)
        ? (item.artists as Array<{ name?: string }>).map((a) => a.name ?? '').filter(Boolean)
        : [];
      converted.track = {
        uri: item.uri,
        name: item.name,
        artists,
        album: (item.album as { name?: string } | undefined)?.name,
        durationMs: durMs,
      };
    }
    return this.reconcile(converted, now);
  }

  public getEffectiveState(now = Date.now()): PlaybackChangedDataT | null {
    this.purgeExpired(now);
    return this.optimisticState ?? this.authoritativeState;
  }

  public getAuthoritativeState(): PlaybackChangedDataT | null {
    return this.authoritativeState;
  }

  public setAuthoritativeState(state: PlaybackChangedDataT): void {
    this.authoritativeState = state;
    if (this.pendingChanges.length === 0) {
      this.optimisticState = state;
    }
  }

  public updatePosition(pos: PlaybackPositionDataT, now = Date.now()): void {
    const target = this.authoritativeState;
    if (!target) return;
    if (
      target.state !== 'playing' &&
      target.state !== 'loading' &&
      pos.revision !== target.revision
    ) {
      return;
    }
    this.authoritativeState = {
      ...target,
      positionMs: pos.positionMs,
      observedAtMonotonicMs: now,
    };
    if (this.optimisticState) {
      this.optimisticState = {
        ...this.optimisticState,
        positionMs: pos.positionMs,
        observedAtMonotonicMs: now,
      };
    }
  }

  public reset(): void {
    this.authoritativeState = null;
    this.optimisticState = null;
    this.pendingChanges = [];
  }

  public hasPendingChanges(now = Date.now()): boolean {
    this.purgeExpired(now);
    return this.pendingChanges.length > 0;
  }

  public getPendingChanges(now = Date.now()): readonly PendingPlaybackChange[] {
    this.purgeExpired(now);
    return this.pendingChanges;
  }

  public clear(): void {
    this.authoritativeState = null;
    this.optimisticState = null;
    this.pendingChanges = [];
  }
}

export const optimisticPlayback = new OptimisticPlaybackStateMachine();
