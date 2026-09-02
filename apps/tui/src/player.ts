/**
 * Player supervisor — owns the lifecycle of `spotoei-player` and the NDJSON
 * transport. See TSD 01 §7-§9 and TSD 06 §1.
 *
 * M0 responsibilities:
 *   * locate the player binary
 *   * spawn it as a child process
 *   * pipe stdin/stdout as NDJSON
 *   * perform the `hello` handshake
 *   * send `shutdown` and wait for clean exit
 *   * surface stderr for diagnostics
 *
 * M0 does NOT:
 *   * supervise crashes (M8)
 *   * hot-reload config
 *   * retry the handshake
 *   * reconnect
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import {
  PROTOCOL_VERSION,
  parseInbound,
  makeHello,
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
const SHUTDOWN_TIMEOUT_MS = 2000;

/**
 * Locate the `spotoei-player` binary.
 *
 * Search order:
 *   1. SPOTOEI_PLAYER_BIN env var (explicit override; release installs use this)
 *   2. <repo-root>/target/debug/spotoei-player (dev: cargo build)
 *   3. <repo-root>/target/release/spotoei-player (dev: cargo build --release)
 *   4. PATH lookup
 */
export function locatePlayer(): string {
  const override = process.env.SPOTOEI_PLAYER_BIN;
  if (override && existsSync(override)) {
    return override;
  }

  // From apps/tui/src -> repo root is ../../../ (apps/tui/src -> apps/tui -> apps -> repo)
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');
  const candidates = [
    join(repoRoot, 'target', 'debug', 'spotoei-player'),
    join(repoRoot, 'target', 'release', 'spotoei-player'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  // Fallback: PATH. Bun spawns the binary by name if it resolves on PATH.
  return 'spotoei-player';
}

/**
 * Spawn the player, wait for hello response, return the live child + handshake.
 * Throws on spawn failure, handshake timeout, or invalid handshake response.
 */
export async function startPlayer(playerBin: string): Promise<HandshakeResult> {
  const child = spawn(playerBin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Inherit is fine for the M0 gate; M8 will gate stderr behind a log facade.
  });

  if (!child.stdout || !child.stdin || !child.stderr) {
    child.kill('SIGKILL');
    throw new Error('player stdio not piped');
  }

  // Mirror stderr for dev diagnostics. M7+ routes this through a log facade.
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[player] ${chunk}`);
  });

  const rl = createInterface({ input: child.stdout });

  const helloId = newRequestId();
  const hello = makeHello(helloId, UI_VERSION);

  const handshake = await new Promise<InboundT>((resolveH, rejectH) => {
    let settled = false;
    const onLine = (line: string) => {
      if (settled) return;
      const r = parseInbound(line);
      if (!r.ok) {
        settled = true;
        rejectH(new Error(`invalid protocol line: ${r.error}`));
        rl.removeListener('line', onLine);
        return;
      }
      const msg = r.value;
      if (msg.type === 'response' && msg.id === helloId) {
        settled = true;
        rl.removeListener('line', onLine);
        resolveH(msg);
      }
    };
    rl.on('line', onLine);

    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        rejectH(new Error(`player exited before handshake (code=${code})`));
      }
    });

    // Write hello after the listener is attached to avoid a race.
    child.stdin!.write(JSON.stringify(hello) + '\n');
  });

  if (handshake.type !== 'response' || !handshake.ok) {
    child.kill('SIGKILL');
    if (handshake.type === 'response') {
      throw new Error(
        `handshake rejected: ${handshake.error?.code} ${handshake.error?.message}`,
      );
    }
    throw new Error('handshake did not return a response');
  }

  const data = handshake.data as {
    protocol?: number;
    playerVersion?: string;
    capabilities?: string[];
  };
  if (data.protocol !== PROTOCOL_VERSION) {
    child.kill('SIGKILL');
    throw new Error(
      `protocol mismatch: client=${PROTOCOL_VERSION} player=${data.protocol}`,
    );
  }

  return {
    protocol: data.protocol,
    playerVersion: data.playerVersion ?? 'unknown',
    capabilities: data.capabilities ?? [],
    child,
  };
}

/**
 * Send `shutdown` and wait for the child to exit cleanly.
 * On timeout, sends SIGKILL.
 */
export async function stopPlayer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  const id = newRequestId();
  const cmd = {
    v: PROTOCOL_VERSION,
    type: 'command',
    id,
    command: 'shutdown',
    data: {},
  };

  await new Promise<void>((resolveStop) => {
    const onExit = () => {
      clearTimeout(timer);
      resolveStop();
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
      resolveStop();
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', onExit);
    try {
      child.stdin?.write(JSON.stringify(cmd) + '\n');
    } catch {
      // stdin may already be closed; exit handler will resolve.
    }
  });
}
