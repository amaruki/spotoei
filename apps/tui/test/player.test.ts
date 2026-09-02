import { describe, expect, test } from 'bun:test';
import { locatePlayer, restartPlayer, startPlayer, stopPlayer } from '../src/player';
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

  test('restartPlayer rejects when restart budget is exhausted', async () => {
    const bin = locatePlayer();
    const h = await startPlayer(bin);
    try {
      // Killing the sidecar once means stopPlayer on restart will see a dead child
      // and succeed. Then startPlayer should succeed again. The budget check
      // requires `restarts >= MAX_RESTARTS (3)`, so passing 3 must reject.
      await expect(restartPlayer(h.child, bin, {}, 3)).rejects.toThrow(/restart budget/);
    } finally {
      try {
        h.child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, 10_000);

  test('restartPlayer replaces a healthy child with a new handshake', async () => {
    const bin = locatePlayer();
    const h1 = await startPlayer(bin);
    const h2 = await restartPlayer(h1.child, bin, {}, 0);
    try {
      expect(h2.protocol).toBe(PROTOCOL_VERSION);
      expect(h2.child.pid).not.toBe(h1.child.pid);
    } finally {
      await stopPlayer(h2.child).catch(() => {
        try {
          h2.child.kill('SIGKILL');
        } catch {
          // ignore
        }
      });
    }
  }, 10_000);
});
