import {
  makePlaybackLoad,
  makePlaybackNext,
  makePlaybackPause,
  makePlaybackPlay,
  makePlaybackPrevious,
  makePlaybackSeek,
  makePlaybackSeekRelative,
  makePlaybackSetAutoplay,
  makePlaybackSetRepeat,
  makePlaybackSetShuffle,
  makePlaybackSetVolume,
  makePlaybackStatus,
  makePlaybackToggle,
  makePlaybackToggleMute,
  makePlaybackGetAudioConfig,
  makePlaybackSetAudioConfig,
  newRequestId,
  type CommandT,
  type PlaybackChangedDataT,
} from 'spotoei-protocol';
import type { AudioConfigData, PlaybackClient } from './types';
import {
  optimisticPlayback,
  validatePlaybackChangedT,
  type OptimisticPlaybackStateMachine,
  type PlaybackAction,
  type Validator,
} from './validator';

type CommandResult = PlaybackChangedDataT;

export interface CommandBuilderDeps {
  sendCommand: <T>(cmd: CommandT, validate: Validator<T>) => Promise<T>;
  setLastSnapshot: (snap: PlaybackChangedDataT) => void;
  getLastSnapshot?: () => PlaybackChangedDataT | null;
  stateMachine?: OptimisticPlaybackStateMachine;
  emitChange?: (snap: PlaybackChangedDataT) => void;
}

function makeOptimisticCommand(
  deps: CommandBuilderDeps,
  actionFactory: () => PlaybackAction,
  build: (id: string) => CommandT,
): () => Promise<CommandResult> {
  const sm = deps.stateMachine ?? optimisticPlayback;
  return async () => {
    const id = newRequestId();
    const action = actionFactory();
    const base = deps.getLastSnapshot?.() ?? sm.getEffectiveState();
    const opt = sm.applyOptimistic(action, id, base);
    deps.setLastSnapshot(opt);
    deps.emitChange?.(opt);

    try {
      const cmd = build(id);
      const data = await deps.sendCommand<CommandResult>(cmd, validatePlaybackChangedT);
      const reconciled = sm.reconcile(data);
      deps.setLastSnapshot(reconciled);
      deps.emitChange?.(reconciled);
      return reconciled;
    } catch (err) {
      const rolledBack = sm.rollback(id);
      if (rolledBack) {
        deps.setLastSnapshot(rolledBack);
        deps.emitChange?.(rolledBack);
      }
      throw err;
    }
  };
}

function makeOptimisticCommandWithArg<Arg>(
  deps: CommandBuilderDeps,
  actionFactory: (arg: Arg) => PlaybackAction,
  build: (id: string, arg: Arg) => CommandT,
): (arg: Arg) => Promise<CommandResult> {
  const sm = deps.stateMachine ?? optimisticPlayback;
  return async (arg: Arg) => {
    const id = newRequestId();
    const action = actionFactory(arg);
    const base = deps.getLastSnapshot?.() ?? sm.getEffectiveState();
    const opt = sm.applyOptimistic(action, id, base);
    deps.setLastSnapshot(opt);
    deps.emitChange?.(opt);

    try {
      const cmd = build(id, arg);
      const data = await deps.sendCommand<CommandResult>(cmd, validatePlaybackChangedT);
      const reconciled = sm.reconcile(data);
      deps.setLastSnapshot(reconciled);
      deps.emitChange?.(reconciled);
      return reconciled;
    } catch (err) {
      const rolledBack = sm.rollback(id);
      if (rolledBack) {
        deps.setLastSnapshot(rolledBack);
        deps.emitChange?.(rolledBack);
      }
      throw err;
    }
  };
}

function makeStatusCommand(
  deps: CommandBuilderDeps,
): () => Promise<CommandResult> {
  const sm = deps.stateMachine ?? optimisticPlayback;
  return async () => {
    const id = newRequestId();
    const cmd = makePlaybackStatus(id);
    const data = await deps.sendCommand<CommandResult>(cmd, validatePlaybackChangedT);
    const reconciled = sm.reconcile(data);
    deps.setLastSnapshot(reconciled);
    deps.emitChange?.(reconciled);
    return reconciled;
  };
}

export function buildCommandMethods(
  deps: CommandBuilderDeps,
): Pick<
  PlaybackClient,
  | 'status'
  | 'load'
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'seek'
  | 'seekRelative'
  | 'setVolume'
  | 'toggleMute'
  | 'setShuffle'
  | 'setRepeat'
  | 'setAutoplay'
  | 'getAudioConfig'
  | 'setAudioConfig'
> {
  return {
    status: makeStatusCommand(deps),
    load: makeOptimisticCommandWithArg<Parameters<PlaybackClient['load']>[0]>(
      deps,
      (opts) => ({ type: 'load', opts }),
      makePlaybackLoad,
    ),
    play: makeOptimisticCommand(deps, () => ({ type: 'play' }), makePlaybackPlay),
    pause: makeOptimisticCommand(deps, () => ({ type: 'pause' }), makePlaybackPause),
    toggle: makeOptimisticCommand(deps, () => ({ type: 'toggle' }), makePlaybackToggle),
    next: makeOptimisticCommand(deps, () => ({ type: 'next' }), makePlaybackNext),
    previous: makeOptimisticCommand(deps, () => ({ type: 'previous' }), makePlaybackPrevious),
    seek: makeOptimisticCommandWithArg(deps, (positionMs) => ({ type: 'seek', positionMs }), makePlaybackSeek),
    seekRelative: makeOptimisticCommandWithArg(deps, (offsetMs) => ({ type: 'seekRelative', offsetMs }), makePlaybackSeekRelative),
    setVolume: makeOptimisticCommandWithArg(deps, (volume) => ({ type: 'setVolume', volume }), makePlaybackSetVolume),
    toggleMute: makeOptimisticCommand(deps, () => ({ type: 'toggleMute' }), makePlaybackToggleMute),
    setShuffle: makeOptimisticCommandWithArg(deps, (shuffle) => ({ type: 'setShuffle', shuffle }), makePlaybackSetShuffle),
    setRepeat: makeOptimisticCommandWithArg<'off' | 'context' | 'track'>(
      deps,
      (repeat) => ({ type: 'setRepeat', repeat }),
      makePlaybackSetRepeat,
    ),
    setAutoplay: makeOptimisticCommandWithArg(deps, (autoplay) => ({ type: 'setAutoplay', autoplay }), makePlaybackSetAutoplay),
    getAudioConfig: async () => {
      const id = newRequestId();
      const cmd = makePlaybackGetAudioConfig(id);
      return deps.sendCommand<AudioConfigData>(cmd, (data) => ({
        ok: true,
        value: data as AudioConfigData,
      }));
    },
    setAudioConfig: async (config) => {
      const id = newRequestId();
      const cmd = makePlaybackSetAudioConfig(id, config);
      return deps.sendCommand<AudioConfigData>(cmd, (data) => ({
        ok: true,
        value: data as AudioConfigData,
      }));
    },
  };
}
