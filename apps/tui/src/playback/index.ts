// Playback client factory. Composes a transport and a set of command
// methods behind a single PlaybackClient facade so callers retain the
// stable one-call API.

import { buildCommandMethods } from './commands';
import { createPlaybackTransport } from './transport';
import type { PlaybackClient, PlaybackClientOptions } from './types';

export type { PlaybackClient, PlaybackClientOptions } from './types';

export function createPlaybackClient(options: PlaybackClientOptions): PlaybackClient {
  const { child, timeoutMs } = options;
  const transport = createPlaybackTransport(child, timeoutMs);
  const commands = buildCommandMethods(transport);

  return {
    ...commands,
    snapshot: () => transport.getLastSnapshot(),
    onChange: (listener) => transport.addChangeListener(listener),
    onPosition: (listener) => transport.addPositionListener(listener),
    close: () => transport.close(),
  };
}
