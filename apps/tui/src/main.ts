/**
 * `spotoei` TUI entry point.
 *
 * Milestone 0 (per TSD 10 §2) gate:
 *   spotoei starts → renders shell → spawns player → handshake → exits cleanly
 *
 * For M0, "renders shell" means printing a short banner to stdout. The full
 * OpenTUI/React rendering pipeline is built out in M7 (UX Completion). This
 * file's job is to validate the process model, IPC, and lifecycle.
 */

import { locatePlayer, startPlayer, stopPlayer } from './player';

function renderShell(handshake: { protocol: number; playerVersion: string; capabilities: string[] }) {
  const caps = handshake.capabilities.length ? handshake.capabilities.join(', ') : '(none)';
  // Plain text for the M0 gate. Replaced by <AppShell/> in M7.
  process.stdout.write(
    [
      '┌────────────────────────────────────────┐',
      '│  SPOTOEI  (Milestone 0)                │',
      '├────────────────────────────────────────┤',
      `│  player  ${handshake.playerVersion.padEnd(28)}│`,
      `│  proto   v${String(handshake.protocol).padEnd(28)}│`,
      `│  caps    ${caps.slice(0, 28).padEnd(28)}│`,
      '└────────────────────────────────────────┘',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
  const playerBin = locatePlayer();
  let child;
  try {
    const handshake = await startPlayer(playerBin);
    child = handshake.child;
    renderShell({
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
    });
  } catch (e) {
    process.stderr.write(`spotoei: failed to start player: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    await stopPlayer(child);
  } catch (e) {
    process.stderr.write(`spotoei: shutdown error: ${(e as Error).message}\n`);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    return 1;
  }
  return 0;
}

const code = await main();
process.exit(code);
