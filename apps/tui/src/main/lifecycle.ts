import type { ChildProcess } from 'node:child_process';

import { stopPlayer } from '../player';
import type { Ui } from '../ui';
import { deferred } from './utils';
import type { Deferred } from './types';

export interface LifecycleHandles {
  ctx: { quit: () => Promise<void> };
  child: ChildProcess;
  ui: Ui;
}

export function installSignalHandlers(quit: () => Promise<void>): void {
  process.on('SIGINT', () => void quit());
  process.on('SIGTERM', () => void quit());
  process.on('SIGHUP', () => void quit());
}

export function installUncaughtHandler(
  getUi: () => Ui | null,
  getChild: () => ChildProcess | null,
): void {
  process.on('uncaughtException', async (err) => {
    const ui = getUi();
    if (ui) {
      try {
        await ui.shutdown();
      } catch {
        // ignore
      }
    }
    process.stderr.write(
      `[spotoei:fatal] uncaught exception: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    const child = getChild();
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    process.exit(1);
  });
}

export function createShutdownFn(
  getUi: () => Ui | null,
  getChild: () => ChildProcess | null,
  requestQuit: Deferred<number>,
): () => Promise<void> {
  let isExiting = false;
  return async () => {
    if (isExiting) return;
    isExiting = true;
    const ui = getUi();
    if (ui) {
      try {
        await ui.shutdown();
      } catch {
        // ignore
      }
    }
    const child = getChild();
    if (child) {
      try {
        await stopPlayer(child);
      } catch {
        // ignore
      }
    }
    requestQuit.trigger(0);
  };
}

export function createRequestQuit<T>(): Deferred<T> {
  return deferred<T>();
}
