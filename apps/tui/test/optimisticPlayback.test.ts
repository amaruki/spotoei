import { describe, expect, test } from 'bun:test';
import type { CommandT, PlaybackChangedDataT } from 'spotoei-protocol';
import { buildCommandMethods } from '../src/playback/commands';
import {
  DEFAULT_OPTIMISTIC_TTL_MS,
  MAX_PENDING_CHANGES,
  OptimisticPlaybackStateMachine,
  type Validator,
} from '../src/playback/validator';

const createSampleState = (overrides: Partial<PlaybackChangedDataT> = {}): PlaybackChangedDataT => ({
  revision: 1,
  state: 'playing',
  track: {
    uri: 'spotify:track:test1',
    name: 'Test Track',
    artists: ['Artist 1'],
    album: 'Album 1',
    durationMs: 200000,
  },
  positionMs: 50000,
  durationMs: 200000,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  autoplay: true,
  observedAtMonotonicMs: 1000,
  ...overrides,
});

describe('OptimisticPlaybackStateMachine', () => {
  test('optimistically transitions play, pause, toggle, seek, next', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'paused', positionMs: 10000 });
    sm.setAuthoritativeState(initial);

    // Play
    const optPlay = sm.applyOptimistic({ type: 'play' }, 'cmd-1');
    expect(optPlay.state).toBe('playing');
    expect(sm.getEffectiveState()?.state).toBe('playing');
    expect(sm.hasPendingChanges()).toBe(true);

    // Pause
    const optPause = sm.applyOptimistic({ type: 'pause' }, 'cmd-2');
    expect(optPause.state).toBe('paused');
    expect(sm.getEffectiveState()?.state).toBe('paused');

    // Toggle
    const optToggle = sm.applyOptimistic({ type: 'toggle' }, 'cmd-3');
    expect(optToggle.state).toBe('playing');
    expect(sm.getEffectiveState()?.state).toBe('playing');

    // Seek
    const optSeek = sm.applyOptimistic({ type: 'seek', positionMs: 90000 }, 'cmd-4');
    expect(optSeek.positionMs).toBe(90000);
    expect(sm.getEffectiveState()?.positionMs).toBe(90000);

    // SeekRelative
    const optSeekRel = sm.applyOptimistic({ type: 'seekRelative', offsetMs: -15000 }, 'cmd-5');
    expect(optSeekRel.positionMs).toBe(75000);
    expect(sm.getEffectiveState()?.positionMs).toBe(75000);

    // Next
    const optNext = sm.applyOptimistic(
      {
        type: 'next',
        track: {
          uri: 'spotify:track:test2',
          name: 'Next Song',
          artists: ['Artist 2'],
          durationMs: 180000,
        },
      },
      'cmd-6',
    );
    expect(optNext.positionMs).toBe(0);
    expect(optNext.track?.name).toBe('Next Song');
    expect(sm.getEffectiveState()?.track?.name).toBe('Next Song');
  });

  test('buffers pending state changes with TTL (1500ms)', () => {
    const sm = new OptimisticPlaybackStateMachine(DEFAULT_OPTIMISTIC_TTL_MS);
    const initial = createSampleState({ state: 'paused' });
    sm.setAuthoritativeState(initial);

    const now = 10000;
    sm.applyOptimistic({ type: 'play' }, 'cmd-play', undefined, now);
    expect(sm.getEffectiveState(now)?.state).toBe('playing');

    // Before TTL expiration (now + 1000ms < 1500ms TTL)
    expect(sm.getEffectiveState(now + 1000)?.state).toBe('playing');
    expect(sm.hasPendingChanges(now + 1000)).toBe(true);

    // After TTL expiration (now + 1600ms > 1500ms TTL)
    expect(sm.getEffectiveState(now + 1600)?.state).toBe('paused');
    expect(sm.hasPendingChanges(now + 1600)).toBe(false);
  });

  test('reconciles cleanly when server state matches pending command', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'paused' });
    sm.setAuthoritativeState(initial);

    sm.applyOptimistic({ type: 'play' }, 'cmd-play');
    expect(sm.hasPendingChanges()).toBe(true);

    const serverPlaying = createSampleState({ revision: 2, state: 'playing' });
    const reconciled = sm.reconcile(serverPlaying);
    expect(reconciled.state).toBe('playing');
    expect(reconciled.revision).toBe(2);
    expect(sm.hasPendingChanges()).toBe(false);
  });

  test('reconciles cleanly when Web API poll returns matching state', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'playing', positionMs: 10000 });
    sm.setAuthoritativeState(initial);

    sm.applyOptimistic({ type: 'pause' }, 'cmd-pause');
    expect(sm.getEffectiveState()?.state).toBe('paused');

    // Web API response with is_playing: false
    sm.reconcileWebApiResponse({
      is_playing: false,
      progress_ms: 10000,
      item: {
        uri: 'spotify:track:test1',
        name: 'Test Track',
        duration_ms: 200000,
      },
    });

    expect(sm.hasPendingChanges()).toBe(false);
    expect(sm.getEffectiveState()?.state).toBe('paused');
  });

  test('maintains optimistic prediction if server state has not matched yet within TTL', () => {
    const sm = new OptimisticPlaybackStateMachine(1500);
    const initial = createSampleState({ state: 'paused' });
    sm.setAuthoritativeState(initial);

    const startTime = 5000;
    sm.applyOptimistic({ type: 'play' }, 'cmd-play', undefined, startTime);

    // An in-flight server event from before play was processed arrives
    const staleServerState = createSampleState({ revision: 1, state: 'paused' });
    const result = sm.reconcile(staleServerState, startTime + 200);

    // Since pending 'play' is still within TTL, effective state remains 'playing'
    expect(result.state).toBe('playing');
    expect(sm.hasPendingChanges(startTime + 200)).toBe(true);

    // But once TTL elapses, it reconciles to server state
    const expiredResult = sm.getEffectiveState(startTime + 1600);
    expect(expiredResult?.state).toBe('paused');
    expect(sm.hasPendingChanges(startTime + 1600)).toBe(false);
  });

  test('rollback smoothly restores previous state on command rejection', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'playing', positionMs: 30000 });
    sm.setAuthoritativeState(initial);

    sm.applyOptimistic({ type: 'pause' }, 'cmd-pause-fail');
    expect(sm.getEffectiveState()?.state).toBe('paused');

    // Server rejects command
    const rolledBack = sm.rollback('cmd-pause-fail');
    expect(rolledBack?.state).toBe('playing');
    expect(rolledBack?.positionMs).toBe(30000);
    expect(sm.getEffectiveState()?.state).toBe('playing');
    expect(sm.hasPendingChanges()).toBe(false);
  });
  test('rapid action spam caps pending changes to 16 without corrupting state', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'playing', positionMs: 0 });
    sm.setAuthoritativeState(initial);

    for (let i = 1; i <= 25; i++) {
      sm.applyOptimistic({ type: 'seekRelative', offsetMs: 100 }, `cmd-${i}`);
    }

    const pending = sm.getPendingChanges();
    expect(pending.length).toBe(MAX_PENDING_CHANGES);
    expect(pending.length).toBe(16);
    expect(pending[0]?.id).toBe('cmd-10');
    expect(pending[15]?.id).toBe('cmd-25');
    expect(sm.getEffectiveState()?.positionMs).toBe(2500);
  });

  test('rollback of intermediate action leaves newer pending action intact', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ state: 'playing', positionMs: 10000 });
    sm.setAuthoritativeState(initial);

    sm.applyOptimistic({ type: 'seekRelative', offsetMs: 1000 }, 'cmd-1');
    sm.applyOptimistic({ type: 'seekRelative', offsetMs: 2000 }, 'cmd-2');
    sm.applyOptimistic({ type: 'seekRelative', offsetMs: 3000 }, 'cmd-3');

    expect(sm.getEffectiveState()?.positionMs).toBe(16000);

    const rolledBack = sm.rollback('cmd-2');
    expect(rolledBack?.positionMs).toBe(14000);
    expect(sm.getEffectiveState()?.positionMs).toBe(14000);

    const remaining = sm.getPendingChanges();
    expect(remaining.length).toBe(2);
    expect(remaining.map((c) => c.id)).toEqual(['cmd-1', 'cmd-3']);
  });

  test('reconciles out-of-order server responses gracefully', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ revision: 1, state: 'paused' });
    sm.setAuthoritativeState(initial);

    sm.applyOptimistic({ type: 'play' }, 'cmd-play');
    sm.applyOptimistic({ type: 'pause' }, 'cmd-pause');

    // Newer server state matching cmd-pause arrives first (revision 3)
    const serverPaused = createSampleState({ revision: 3, state: 'paused' });
    const reconciled1 = sm.reconcile(serverPaused);
    expect(reconciled1.state).toBe('paused');
    expect(reconciled1.revision).toBe(3);
    expect(sm.hasPendingChanges()).toBe(false);

    // Stale delayed response from cmd-play arrives later (revision 2)
    const staleServerPlay = createSampleState({ revision: 2, state: 'playing' });
    const reconciled2 = sm.reconcile(staleServerPlay);
    expect(reconciled2.state).toBe('paused');
    expect(reconciled2.revision).toBe(3);
    expect(sm.getEffectiveState()?.state).toBe('paused');
  });

  test('partial TTL purge recalculates remaining pending changes cleanly', () => {
    const sm = new OptimisticPlaybackStateMachine(1000);
    const initial = createSampleState({ state: 'playing', positionMs: 5000 });
    sm.setAuthoritativeState(initial);

    const t0 = 10000;
    sm.applyOptimistic({ type: 'seekRelative', offsetMs: 1000 }, 'cmd-old', undefined, t0);
    sm.applyOptimistic({ type: 'seekRelative', offsetMs: 2000 }, 'cmd-new', undefined, t0 + 600);

    expect(sm.getEffectiveState(t0 + 700)?.positionMs).toBe(8000);

    // t0 + 1200: cmd-old expired (>1000ms), cmd-new still active (<1000ms)
    const stateAfterPartialExpiry = sm.getEffectiveState(t0 + 1200);
    expect(stateAfterPartialExpiry?.positionMs).toBe(7000);
    expect(sm.getPendingChanges(t0 + 1200).length).toBe(1);
    expect(sm.getPendingChanges(t0 + 1200)[0]?.id).toBe('cmd-new');
  });

  test('updatePosition syncs authoritative and optimistic state immediately', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ revision: 5, state: 'playing', positionMs: 5000 });
    sm.setAuthoritativeState(initial);

    const now = 1710000000000;
    sm.updatePosition({ revision: 5, positionMs: 12500 }, now);

    const effective = sm.getEffectiveState();
    expect(effective?.positionMs).toBe(12500);
    expect(effective?.observedAtMonotonicMs).toBe(now);
  });

  test('updatePosition ignores stale revision when not playing or loading', () => {
    const sm = new OptimisticPlaybackStateMachine();
    const initial = createSampleState({ revision: 5, state: 'idle', positionMs: 0 });
    sm.setAuthoritativeState(initial);

    sm.updatePosition({ revision: 4, positionMs: 10000 }, 1710000000000);
    expect(sm.getEffectiveState()?.positionMs).toBe(0);
  });
});

describe('buildCommandMethods optimistic dispatch & rollback', () => {
  test('synchronously updates snapshot and emits change before command resolves', async () => {
    const initial = createSampleState({ state: 'paused', positionMs: 12000 });
    let snapshot: PlaybackChangedDataT = initial;
    const emitted: PlaybackChangedDataT[] = [];

    const { promise, resolve } = Promise.withResolvers<PlaybackChangedDataT>();

    const sendCommand = async <T>(_cmd: CommandT, _val: Validator<T>): Promise<T> => {
      const result = await promise;
      return result as unknown as T;
    };

    const sm = new OptimisticPlaybackStateMachine();
    sm.setAuthoritativeState(initial);

    const deps = {
      sendCommand,
      stateMachine: sm,
      setLastSnapshot: (snap: PlaybackChangedDataT) => {
        snapshot = snap;
      },
      getLastSnapshot: () => snapshot,
      emitChange: (snap: PlaybackChangedDataT) => {
        emitted.push(snap);
      },
    };

    const client = buildCommandMethods(deps);

    // Call client.play() - returns promise
    const playPromise = client.play();

    // In the EXACT SAME TICK (1 frame tactile response), snapshot & emitted are already 'playing'!
    expect(snapshot.state).toBe('playing');
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]?.state).toBe('playing');

    // Server responds
    resolve(createSampleState({ state: 'playing', revision: 2 }));
    const result = await playPromise;

    expect(result.state).toBe('playing');
    expect(result.revision).toBe(2);
  });

  test('synchronously updates on seek and rolls back when server rejects', async () => {
    const initial = createSampleState({ state: 'playing', positionMs: 10000 });
    let snapshot: PlaybackChangedDataT = initial;
    const emitted: PlaybackChangedDataT[] = [];

    const { promise, reject } = Promise.withResolvers<PlaybackChangedDataT>();

    const sendCommand = async <T>(_cmd: CommandT, _val: Validator<T>): Promise<T> => {
      const result = await promise;
      return result as unknown as T;
    };

    const sm = new OptimisticPlaybackStateMachine();
    sm.setAuthoritativeState(initial);

    const deps = {
      sendCommand,
      stateMachine: sm,
      setLastSnapshot: (snap: PlaybackChangedDataT) => {
        snapshot = snap;
      },
      getLastSnapshot: () => snapshot,
      emitChange: (snap: PlaybackChangedDataT) => {
        emitted.push(snap);
      },
    };

    const client = buildCommandMethods(deps);

    const seekPromise = client.seek(80000);

    // Optimistically updated immediately to 80000
    expect(snapshot.positionMs).toBe(80000);
    expect(emitted[0]?.positionMs).toBe(80000);

    // Server rejects
    reject(new Error('SEEK_FAILED'));

    await expect(seekPromise).rejects.toThrow('SEEK_FAILED');

    // Rollback restored previous position (10000)
    expect(snapshot.positionMs).toBe(10000);
    expect(emitted[emitted.length - 1]?.positionMs).toBe(10000);
  });
});
