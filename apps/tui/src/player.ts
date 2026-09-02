import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// Strip terminal control characters, ANSI escapes, and OSC sequences
// to prevent terminal title rewrites, clear-screens, or cursor moves.
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;


function sanitizeStderr(chunk: Buffer): string {
  return chunk
    .toString('utf8')
    .replace(ANSI_REGEX, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Locate the player binary.
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

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');
  const candidates = [
    join(repoRoot, 'target', 'debug', 'spotoei-player'),
    join(repoRoot, 'target', 'release', 'spotoei-player'),
  ];
  for (const c of candidates) {
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

  const rl = createInterface({ input: child.stdout });
  const helloId = newRequestId();
  const hello = makeHello(helloId, UI_VERSION);

  let timer: NodeJS.Timeout | undefined;

  try {
    const handshakeMsg = await new Promise<InboundT>((resolveH, rejectH) => {
      let settled = false;

      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          rejectH(new Error(`handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
        }
      }, HANDSHAKE_TIMEOUT_MS);

      const onLine = (line: string) => {
        if (settled) return;
        const r = parseInbound(line);
        if (!r.ok) {
          settled = true;
          child.kill('SIGKILL');
          rejectH(new Error(`invalid protocol line: ${r.error}`));
          return;
        }
        const msg = r.value;
        if (msg.type === 'response' && msg.id === helloId) {
          settled = true;
          resolveH(msg);
        }
      };

      rl.on('line', onLine);

      child.once('error', (err) => {
        if (!settled) {
          settled = true;
          rejectH(err);
        }
      });

      child.once('exit', (code) => {
        if (!settled) {
          settled = true;
          rejectH(new Error(`player exited before handshake (code=${code})`));
        }
      });

      child.stdin!.write(JSON.stringify(hello) + '\n');
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
      throw new Error(
        `protocol mismatch: client=${PROTOCOL_VERSION} player=${data.protocol}`,
      );
    }

    return {
      protocol: data.protocol,
      playerVersion: data.playerVersion,
      capabilities: data.capabilities,
      child,
    };
  } finally {
    clearTimeout(timer);
    rl.close();
  }
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

    const onExit = () => {
      clearTimeout(timer);
      resolveStop();
    };

    child.once('exit', onExit);

    // Arm the grace timer immediately so wedged/unresponsive stdin pipes
    // still trigger SIGKILL escalation within SHUTDOWN_TIMEOUT_MS.
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Child may already have exited.
      }
      resolveStop();
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      child.stdin?.write(JSON.stringify(cmd) + '\n');
    } catch {
      // If stdin was already closed, the exit handler will resolve the promise.
    }
  });
}
