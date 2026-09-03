import {
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
} from 'spotoei-protocol';
import type { PlaybackClient } from './types';
import { validatePlaybackChangedT } from './validator';

type CommandResult = PlaybackChangedDataT;

export interface CommandBuilderDeps {
  sendCommand: <T>(
    cmd: import('spotoei-protocol').CommandT,
    validate: import('./validator').Validator<T>,
  ) => Promise<T>;
  setLastSnapshot: (snap: PlaybackChangedDataT) => void;
}

function makeCommand(
  transport: CommandBuilderDeps,
  build: (id: string) => import('spotoei-protocol').CommandT,
): () => Promise<CommandResult> {
  return async () => {
    const id = newRequestId();
    const cmd = build(id);
    const data = await transport.sendCommand<CommandResult>(cmd, validatePlaybackChangedT);
    transport.setLastSnapshot(data);
    return data;
  };
}

function makeCommandWithArg<Arg>(
  transport: CommandBuilderDeps,
  build: (id: string, arg: Arg) => import('spotoei-protocol').CommandT,
): (arg: Arg) => Promise<CommandResult> {
  return async (arg: Arg) => {
    const id = newRequestId();
    const cmd = build(id, arg);
    const data = await transport.sendCommand<CommandResult>(cmd, validatePlaybackChangedT);
    transport.setLastSnapshot(data);
    return data;
  };
}

export function buildCommandMethods(deps: CommandBuilderDeps): Pick<
  PlaybackClient,
  | 'status'
  | 'load'
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'seek'
  | 'setVolume'
  | 'setShuffle'
  | 'setRepeat'
  | 'setAutoplay'
> {
  return {
    status: makeCommand(deps, makePlaybackStatus),
    load: makeCommandWithArg(deps, makePlaybackLoad),
    play: makeCommand(deps, makePlaybackPlay),
    pause: makeCommand(deps, makePlaybackPause),
    toggle: makeCommand(deps, makePlaybackToggle),
    next: makeCommand(deps, makePlaybackNext),
    previous: makeCommand(deps, makePlaybackPrevious),
    seek: makeCommandWithArg(deps, makePlaybackSeek),
    setVolume: makeCommandWithArg(deps, makePlaybackSetVolume),
    setShuffle: makeCommandWithArg(deps, makePlaybackSetShuffle),
    setRepeat: makeCommandWithArg(deps, makePlaybackSetRepeat),
    setAutoplay: makeCommandWithArg(deps, makePlaybackSetAutoplay),
  };
}
