import type { ChildProcess } from 'node:child_process';
import { SHUTDOWN_TIMEOUT_MS, makeShutdown, newRequestId } from 'spotoei-protocol';
import type { HandshakeResult } from './types';
import { closeSharedReadline } from './readline';
import { startPlayer } from './handshake';

const MAX_RESTARTS = 3;
const BASE_BACKOFF_MS = 250;

/**
 * Send `shutdown` to the player and wait for it to exit cleanly.
 *
 * Arms a 2-second grace period immediately. If the child is still running
 * after the grace period expires, it is escalated to SIGKILL.
 */
export async function stopPlayer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const id = newRequestId();
  const cmd = makeShutdown(id);

  await new Promise<void>((resolveStop) => {
    const onSettled = (timer: NodeJS.Timeout) => {
      clearTimeout(timer);
      setImmediate(resolveStop);
    };
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Child may already have exited.
      }
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => onSettled(killTimer));
    child.once('close', () => onSettled(killTimer));
    try {
      child.stdin?.write(JSON.stringify(cmd) + '\n');
    } catch {
      // If stdin was already closed, the exit handler will resolve the promise.
    }
  });
  closeSharedReadline(child);
}

/**
 * Restart the player process: stop the existing child (best-effort), then start
 * a new instance and complete the hello handshake.
 *
 * Implements bounded exponential backoff via `restarts` so the UI cannot spin
 * forever on a hostile sidecar.
 */
export async function restartPlayer(
  child: ChildProcess,
  playerBin: string,
  extraEnv: Record<string, string> = {},
  restarts = 0,
): Promise<HandshakeResult> {
  if (restarts >= MAX_RESTARTS) {
    throw new Error(`player restart budget exhausted after ${restarts} attempts`);
  }
  try {
    await stopPlayer(child);
  } catch {
    // Best-effort: ignore shutdown error on a crashed sidecar
  }
  const backoffMs = BASE_BACKOFF_MS * 2 ** restarts;
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, backoffMs));
  return startPlayer(playerBin, extraEnv);
}
