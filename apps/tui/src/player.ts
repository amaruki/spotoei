import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import {
  PROTOCOL_VERSION,
  HANDSHAKE_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  HelloResponse,
  parseInbound,
  makeHello,
  makeShutdown,
  newRequestId,
  type InboundT,
} from 'spotoei-protocol';

export interface HandshakeResult {
  protocol: number;
  playerVersion: string;
  capabilities: string[];
  child: ChildProcess;
}
const UI_VERSION = 'spotoei-tui/0.0.0';
const sharedReadlines = new Map<ChildProcess, ReturnType<typeof createInterface>>();
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

function sanitizeStderr(chunk: Buffer): string {
  // eslint-disable-next-line no-control-regex
  const controlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  return chunk.toString('utf8').replace(ANSI_REGEX, '').replace(controlChars, '');
}
/**
 *
 * Search order:
 *   1. `SPOTOEI_PLAYER_BIN` env var (canonicalized via realpath).
 *   2. Repo-local target/debug or target/release build.
 *   3. PATH fallback (development only; refused in production builds).
 */
export function locatePlayer(): string {
  const override = process.env.SPOTOEI_PLAYER_BIN;
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(`SPOTOEI_PLAYER_BIN must be an absolute path: ${override}`);
    }
    if (!existsSync(override)) {
      throw new Error(`SPOTOEI_PLAYER_BIN not found: ${override}`);
    }
    return realpathSync(override);
  }

  // In development and test runs (invoked through `bun test` or `bun run`),
  // `import.meta.url` points to the real source file path. In standalone
  // compiled binaries, Bun embeds code at `$bunfs/...`, so we must inspect
  // both `process.execPath` and the module URL's directory.
  const fileDir = (() => {
    try {
      const u = new URL(import.meta.url);
      if (u.protocol === 'file:') return dirname(u.pathname);
    } catch {
      // ignore
    }
    return dirname(realpathSync(process.execPath));
  })();
  const execDir = dirname(realpathSync(process.execPath));

  const packagedCandidates = [
    join(execDir, 'spotoei-player'),
    join(execDir, 'libexec', 'spotoei-player'),
    join(execDir, '..', 'libexec', 'spotoei-player'),
    join(execDir, '..', 'spotoei-player'),
  ];
  for (const c of packagedCandidates) {
    if (existsSync(c)) {
      return realpathSync(c);
    }
  }

  const repoRoot = resolve(fileDir, '..', '..', '..');
  const devCandidates = [
    join(repoRoot, 'target', 'debug', 'spotoei-player'),
    join(repoRoot, 'target', 'release', 'spotoei-player'),
  ];
  for (const c of devCandidates) {
    if (existsSync(c)) {
      return realpathSync(c);
    }
  }

  // Refuse bare PATH fallback in production to avoid executing a hijacked binary.
  const isDev = process.env.NODE_ENV !== 'production' || process.env.SPOTOEI_DEV === '1';
  if (isDev) {
    return 'spotoei-player';
  }

  throw new Error(
    'spotoei-player binary not found; build it with cargo build or set SPOTOEI_PLAYER_BIN',
  );
}

/**
 * Spawn the player child, pipe stdin/stdout, and complete the hello handshake.
 *
 * Enforces a strict 5-second handshake deadline. Child is force-killed on
 * timeout, parse failure, spawn error, or if the hello response fails schema validation.
 */
export async function startPlayer(
  playerBin: string,
  extraEnv: Record<string, string> = {},
): Promise<HandshakeResult> {
  // Pass an explicit allowlist of environment variables to prevent secret leaks.
  const cleanEnv: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: process.env.TERM ?? 'xterm-256color',
    RUST_LOG: process.env.RUST_LOG ?? 'info',
  };
  for (const [k, v] of Object.entries(extraEnv)) {
    cleanEnv[k] = v;
  }

  const child = spawn(playerBin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  if (!child.stdout || !child.stdin || !child.stderr) {
    child.kill('SIGKILL');
    throw new Error('player stdio not piped');
  }

  const stderrListener = (chunk: Buffer) => {
    process.stderr.write(`[player] ${sanitizeStderr(chunk)}`);
  };
  child.stderr.on('data', stderrListener);

  const rl = getSharedReadline(child);
  const helloId = newRequestId();
  const hello = makeHello(helloId, UI_VERSION);
  let timer: NodeJS.Timeout | undefined;

  try {
    const handshakeMsg = await new Promise<InboundT>((resolveH, rejectH) => {
      let settled = false;

      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        rejectH(err);
      };
      const settleResolve = (msg: InboundT): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveH(msg);
      };

      timer = setTimeout(() => {
        settleReject(new Error(`handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
      }, HANDSHAKE_TIMEOUT_MS);

      child.once('error', (err) => {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      });

      child.once('exit', (code) => {
        settleReject(new Error(`player exited before handshake (code=${code})`));
      });

      const onLine = (line: string): void => {
        const r = parseInbound(line);
        if (!r.ok) {
          settleReject(new Error(`invalid protocol line: ${r.error}`));
          return;
        }
        const msg = r.value;
        if (msg.type === 'response' && msg.id === helloId) {
          settleResolve(msg);
        }
      };

      // Wait for the hello frame to be drained to the OS pipe before
      // attaching the readline listener. Without this drain, a fast
      // sidecar reply can race the read loop and be discarded, which
      // is what causes handshake timeouts under Bun.
      child.stdin!.write(JSON.stringify(hello) + '\n', (writeErr) => {
        if (writeErr) {
          settleReject(writeErr);
          return;
        }
        rl.on('line', onLine);
      });
    });

    // Validate the handshake response with the strict HelloResponse schema.
    const parsed = HelloResponse.safeParse(handshakeMsg);
    if (!parsed.success) {
      child.kill('SIGKILL');
      throw new Error(`invalid hello response: ${parsed.error.message}`);
    }

    const { data } = parsed.data;
    if (data.protocol !== PROTOCOL_VERSION) {
      child.kill('SIGKILL');
      throw new Error(`protocol mismatch: client=${PROTOCOL_VERSION} player=${data.protocol}`);
    }

    return {
      protocol: data.protocol,
      playerVersion: data.playerVersion,
      capabilities: data.capabilities,
      child,
    };
  } finally {
    clearTimeout(timer);
  }
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
  const MAX_RESTARTS = 3;
  const BASE_BACKOFF_MS = 250;
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
/**
 * Send `shutdown` to the player and wait for it to exit cleanly.
 *
 * Arms a 2-second grace period immediately. If the child is still running
 * after the grace period expires, it is escalated to SIGKILL.
 */
export async function stopPlayer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  const id = newRequestId();
  const cmd = makeShutdown(id);

  await new Promise<void>((resolveStop) => {
    let timer: NodeJS.Timeout | undefined;

    const onSettled = () => {
      clearTimeout(timer);
      setImmediate(resolveStop);
    };
    child.once('exit', onSettled);
    child.once('close', onSettled);

    // Arm the grace timer immediately so wedged/unresponsive stdin pipes
    // still trigger SIGKILL escalation within SHUTDOWN_TIMEOUT_MS.
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Child may already have exited.
      }
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      child.stdin?.write(JSON.stringify(cmd) + '\n');
    } catch {
      // If stdin was already closed, the exit handler will resolve the promise.
    }
  });
  closeSharedReadline(child);
}

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
