import type { ChildProcess } from 'node:child_process';

import { stopPlayer } from '../player';
import type { Ui } from '../ui';
import { deferred } from './utils';
import type { Deferred } from './types';
import { reportFailure } from '../diagnostics';

export interface LifecycleHandles {
  ctx: { quit: () => Promise<void> };
  child: ChildProcess;
  ui: Ui;
}

export function installSignalHandlers(quit: () => Promise<void>): () => void {
  const handler = () => void quit();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) process.on(signal, handler);
  return () => {
    for (const signal of signals) process.off(signal, handler);
  };
}

export function installUncaughtHandler(
  getUi: () => Ui | null,
  getChild: () => ChildProcess | null,
): () => void {
  const handler = async (err: unknown) => {
    const id = reportFailure('runtime', 'unhandled', err);
    const ui = getUi();
    if (ui) {
      try {
        await ui.shutdown();
      } catch {
        // ignore
      }
    }
    process.stderr.write(
      `[spotoei:fatal] Unhandled runtime error [${id}]. See the diagnostic log.\n`,
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
  };
  process.on('uncaughtException', handler);
  process.on('unhandledRejection', handler);
  return () => {
    process.off('uncaughtException', handler);
    process.off('unhandledRejection', handler);
  };
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
