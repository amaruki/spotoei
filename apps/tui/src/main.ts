import { spawn } from 'node:child_process';

import { locatePlayer, startPlayer, stopPlayer } from './player';
import { createAuthClient } from './auth';

function renderShell(info?: {
  protocol: number;
  playerVersion: string;
  capabilities: string[];
  auth?: {
    state: string;
    accountId?: string | null;
    storage?: string;
    authUrl?: string | null;
  };
}) {
  const playerLine = info ? `│  player  ${info.playerVersion.padEnd(28)}│` : '│  player  (spawning...)               │';
  const protoLine = info ? `│  proto   v${String(info.protocol).padEnd(28)}│` : '│  proto   (pending...)                │';
  const caps = info
    ? info.capabilities.length
      ? info.capabilities.join(', ')
      : '(none)'
    : '(pending...)';

  const authLine = info?.auth
    ? `│  auth    ${info.auth.state.padEnd(28)}│`
    : '│  auth    (pending...)                │';
  const authDetail = info?.auth
    ? info.auth.state === 'authenticating' && info.auth.authUrl
      ? `│  ↳ open in browser: ${info.auth.authUrl.slice(0, 18).padEnd(18)}│`
      : info.auth.state === 'authenticated' && info.auth.accountId
        ? `│  ↳ account: ${info.auth.accountId.slice(0, 20).padEnd(20)}│`
        : info.auth.state === 'refresh-failed'
          ? `│  ↳ reauth required                  │`
          : `│  ↳                                  │`
    : '│  ↳ (awaiting handshake)             │';

  process.stdout.write(
    [
      '┌────────────────────────────────────────┐',
      '│  SPOTOEI  (Milestone 1)                │',
      '├────────────────────────────────────────┤',
      playerLine,
      protoLine,
      `│  caps    ${caps.slice(0, 28).padEnd(28)}│`,
      '├────────────────────────────────────────┤',
      authLine,
      authDetail,
      '└────────────────────────────────────────┘',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1));
  }

  // The client renders its shell BEFORE spawning the player child, ensuring
  // immediate visual feedback without waiting for child process startup.
  renderShell();

  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let child;
  try {
    const handshake = await startPlayer(playerBin);
    child = handshake.child;
    const auth = createAuthClient({ child });
    const initial = await auth.status();
    renderShell({
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
      auth: {
        state: initial.state,
        accountId: initial.accountId,
        storage: initial.storage,
        authUrl: initial.authUrl,
      },
    });
    auth.onStatusChange((next) => {
      renderShell({
        protocol: handshake.protocol,
        playerVersion: handshake.playerVersion,
        capabilities: handshake.capabilities,
        auth: {
          state: next.state,
          accountId: next.accountId,
          storage: next.storage,
          authUrl: next.authUrl,
        },
      });
    });
    // Touch the auth client briefly so the readline listener is active.
    // In M2+ this becomes the queue for play commands.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    auth.close();
  } catch (e) {
    process.stderr.write(`spotoei: failed to start player: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  try {
    await stopPlayer(child);
  } catch (e) {
    process.stderr.write(`spotoei: shutdown error: ${e instanceof Error ? e.message : String(e)}\n`);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    return 1;
  }
  return 0;
}

function runDoctor(args: string[]): number {
  const sub = args[0] ?? 'all';
  const playerBin = (() => {
    try {
      return locatePlayer();
    } catch {
      return null;
    }
  })();
  if (!playerBin) {
    process.stderr.write('spotoei doctor: player binary not found\n');
    return 1;
  }
  // Delegate to the sidecar. The Rust `doctor` subcommand does the
  // detailed keyring and account reporting.
  const result = spawnSync(playerBin, ['doctor', sub], { stdio: 'inherit' });
  return result ?? 0;
}

function spawnSync(cmd: string, args: string[], opts: { stdio: 'inherit' }): number | null {
  try {
    const child = spawn(cmd, args, { stdio: opts.stdio, env: process.env });
    child.on('error', () => {
      // ignore
    });
    return null;
  } catch {
    return null;
  }
}

const code = await main();
process.exit(code);
