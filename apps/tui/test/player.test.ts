/**
 * End-to-end player integration test.
 * Verifies the TSD 10 §2 M0 gate: spawn → handshake → shutdown → clean exit.
 *
 * The test locates the player binary the same way the runtime does, then
 * drives the same `startPlayer` / `stopPlayer` code path.
 */

import { describe, expect, test } from 'bun:test';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { PROTOCOL_VERSION } from 'spotoei-protocol';

describe('player integration (M0 gate)', () => {
  test('handshake + shutdown exits cleanly', async () => {
    const bin = locatePlayer();
    const h = await startPlayer(bin);
    expect(h.protocol).toBe(PROTOCOL_VERSION);
    expect(typeof h.playerVersion).toBe('string');
    expect(Array.isArray(h.capabilities)).toBe(true);
    await stopPlayer(h.child);
    // After shutdown, child must be gone.
    expect(h.child.exitCode).not.toBeNull();
  }, 10_000);
});
