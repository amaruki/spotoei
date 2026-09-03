import { PROTOCOL_VERSION } from './constants';
import type { CommandName } from './constants';
import type { CommandT } from './schemas';

// Constructors for the wire envelope. Use these instead of hand-rolling the
// object literal so the schema is the single source of truth.
export function makeCommand(
  id: string,
  command: CommandName,
  data: Record<string, unknown> = {},
): CommandT {
  return {
    v: PROTOCOL_VERSION,
    type: 'command',
    id,
    command,
    data,
  };
}

export function makeHello(id: string, uiVersion: string): CommandT {
  return makeCommand(id, 'hello', { protocols: [PROTOCOL_VERSION], uiVersion });
}

export function makeShutdown(id: string): CommandT {
  return makeCommand(id, 'shutdown', {});
}
