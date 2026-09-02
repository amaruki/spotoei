import { locatePlayer, startPlayer, stopPlayer } from './player';

function renderShell(info?: { protocol: number; playerVersion: string; capabilities: string[] }) {
  const playerLine = info ? `│  player  ${info.playerVersion.padEnd(28)}│` : '│  player  (spawning...)               │';
  const protoLine = info ? `│  proto   v${String(info.protocol).padEnd(28)}│` : '│  proto   (pending...)                │';
  const caps = info
    ? info.capabilities.length
      ? info.capabilities.join(', ')
      : '(none)'
    : '(pending...)';

  process.stdout.write(
    [
      '┌────────────────────────────────────────┐',
      '│  SPOTOEI  (Milestone 0)                │',
      '├────────────────────────────────────────┤',
      playerLine,
      protoLine,
      `│  caps    ${caps.slice(0, 28).padEnd(28)}│`,
      '└────────────────────────────────────────┘',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
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
    // Re-render once the handshake resolves with full player info.
    renderShell({
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
    });
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

const code = await main();
process.exit(code);
