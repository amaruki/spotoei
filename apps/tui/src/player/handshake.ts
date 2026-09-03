import { spawn } from 'node:child_process';
import {
  PROTOCOL_VERSION,
  HANDSHAKE_TIMEOUT_MS,
  HelloResponse,
  parseInbound,
  makeHello,
  newRequestId,
  type InboundT,
} from 'spotoei-protocol';
import { getLogPath, logToFile, resolveRedirectPort } from '../config';
import { getSharedReadline } from './readline';
import { sanitizeStderr } from './sanitize';
import type { HandshakeResult } from './types';
import { UI_VERSION } from './types';

/**
 * Build the explicit allowlist of environment variables passed to the
 * spawned player child. Anything not in this list is dropped to prevent
 * secret leaks (e.g. SPOTOEI_CLIENT_SECRET, *_TOKEN, etc).
 */
function buildCleanEnv(extra: Record<string, string>): Record<string, string | undefined> {
  const clean: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: process.env.TERM ?? 'xterm-256color',
    RUST_LOG: process.env.RUST_LOG ?? 'info',
    SPOTOEI_CLIENT_ID: process.env.SPOTOEI_CLIENT_ID,
    SPOTOEI_REDIRECT_PORT: process.env.SPOTOEI_REDIRECT_PORT ?? String(resolveRedirectPort()),
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    PULSE_SERVER: process.env.PULSE_SERVER,
    PIPEWIRE_RUNTIME_DIR: process.env.PIPEWIRE_RUNTIME_DIR,
    ALSA_CARD: process.env.ALSA_CARD,
    ALSA_DEVICE: process.env.ALSA_DEVICE,
    SPOTOEI_LOG_FILE: getLogPath(),
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    SPOTOEI_MOCK_PLAYER: process.env.SPOTOEI_MOCK_PLAYER,
    SPOTOEI_MOCK_AUTH: process.env.SPOTOEI_MOCK_AUTH,
  };
  for (const [k, v] of Object.entries(extra)) {
    clean[k] = v;
  }
  return clean;
}

function onPlayerStderr(chunk: Buffer): void {
  const text = sanitizeStderr(chunk);
  if (!process.stdout.isTTY) {
    process.stderr.write(`[player] ${text}`);
  }
  logToFile(`[player] ${text.trimEnd()}`);
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
  const cleanEnv = buildCleanEnv(extraEnv);
  const child = spawn(playerBin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  if (!child.stdout || !child.stdin || !child.stderr) {
    child.kill('SIGKILL');
    throw new Error('player stdio not piped');
  }

  child.stderr.on('data', onPlayerStderr);

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

      // Attach the readline listener BEFORE the hello frame goes out
      // over stdin. The player can reply with `hello` synchronously
      // after parsing our frame; if the listener is attached later
      // (post-write), the line arrives in the readline buffer before
      // we subscribe and gets silently dropped.
      rl.on('line', onLine);

      child.stdin!.write(JSON.stringify(hello) + '\n', (e) => {
        if (e) {
          settleReject(e instanceof Error ? e : new Error(String(e)));
        }
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
