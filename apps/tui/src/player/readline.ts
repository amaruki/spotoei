import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const sharedReadlines = new Map<ChildProcess, ReturnType<typeof createInterface>>();

/**
 * Get (or lazily attach) the shared readline interface used to read
 * the player's NDJSON stdout stream. Multiple clients can attach `line`
 * listeners to the same instance via `getSharedReadline(child)`.
 */
export function getSharedReadline(child: ChildProcess): ReturnType<typeof createInterface> {
  const existing = sharedReadlines.get(child);
  const isClosed = (existing as unknown as { closed?: boolean } | undefined)?.closed;
  if (!existing || isClosed) {
    if (!child.stdout) {
      throw new Error('child.stdout is required for readline');
    }
    const rl = createInterface({ input: child.stdout });
    sharedReadlines.set(child, rl);
    return rl;
  }
  return existing;
}

export function closeSharedReadline(child: ChildProcess): void {
  const rl = sharedReadlines.get(child);
  if (rl) {
    try {
      rl.close();
    } catch {
      // ignore
    }
    sharedReadlines.delete(child);
  }
}
