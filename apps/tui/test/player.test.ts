import { describe, expect, test } from 'bun:test';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { PROTOCOL_VERSION } from 'spotoei-protocol';

describe('player integration (M0 gate)', () => {
  test('handshake + shutdown exits cleanly', async () => {
    const bin = locatePlayer();
    const h = await startPlayer(bin);
    try {
      expect(h.protocol).toBe(PROTOCOL_VERSION);
      expect(typeof h.playerVersion).toBe('string');
      expect(Array.isArray(h.capabilities)).toBe(true);
    } finally {
      // Always stop the player to prevent orphan child processes on assertion failure.
      await stopPlayer(h.child).catch(() => {
        try {
          h.child.kill('SIGKILL');
        } catch {
          // child already dead
        }
      });
    }
    expect(h.child.exitCode).not.toBeNull();
  }, 10_000);
});
