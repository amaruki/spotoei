// M0 protocol fixtures. Synthetic data only; never include real user content.
// See TSD 07 §18.2 + TSD 11 §18.2 for the contract-test policy.

import { PROTOCOL_VERSION } from '../src/index';

export const helloCommand = {
  v: PROTOCOL_VERSION as 1,
  type: 'command' as const,
  id: '00000000-0000-0000-0000-000000000001',
  command: 'hello' as const,
  data: {
    protocols: [1],
    uiVersion: 'spotoei-tui/0.0.0',
  },
};

export const helloResponse = {
  v: PROTOCOL_VERSION as 1,
  type: 'response' as const,
  id: '00000000-0000-0000-0000-000000000001',
  ok: true as const,
  data: {
    protocol: 1,
    playerVersion: 'spotoei-player/0.0.0',
    capabilities: [] as string[],
  },
};
