import { spawnSync } from 'node:child_process';
import { locatePlayer, startPlayer, stopPlayer } from './player';
import { createAuthClient } from './auth';
import { createPlaybackClient } from './playback';
import type { AuthStatusDataT, PlaybackChangedDataT } from 'spotoei-protocol';

function renderShell(info?: {
  protocol: number;
  playerVersion: string;
  capabilities: string[];
  auth?: AuthStatusDataT;
  playback?: PlaybackChangedDataT | null;
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

  const trackName = info?.playback?.track
    ? `${info.playback.track.name} - ${info.playback.track.artists.join(', ')}`
    : '(no track)';
  const playbackState = info?.playback
    ? `${info.playback.state} [vol:${Math.round(info.playback.volume * 100)}%]`
    : '(idle)';
  const playbackLine = `│  play    ${playbackState.slice(0, 28).padEnd(28)}│`;
  const trackLine = `│  ↳ track ${trackName.slice(0, 28).padEnd(28)}│`;

  process.stdout.write(
    [
      '┌────────────────────────────────────────┐',
      '│  SPOTOEI  (Milestone 2)                │',
      '├────────────────────────────────────────┤',
      playerLine,
      protoLine,
      `│  caps    ${caps.slice(0, 28).padEnd(28)}│`,
      '├────────────────────────────────────────┤',
      authLine,
      authDetail,
      '├────────────────────────────────────────┤',
      playbackLine,
      trackLine,
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
    const playback = createPlaybackClient({ child });
    const initialAuth = await auth.status();
    const initialPlayback = await playback.status();

    const currentInfo = {
      protocol: handshake.protocol,
      playerVersion: handshake.playerVersion,
      capabilities: handshake.capabilities,
      auth: {
        state: initialAuth.state,
        accountId: initialAuth.accountId,
        storage: initialAuth.storage,
        authUrl: initialAuth.authUrl,
      },
      playback: initialPlayback,
    };

    renderShell(currentInfo);

    auth.onStatusChange((next) => {
      currentInfo.auth = {
        state: next.state,
        accountId: next.accountId,
        storage: next.storage,
        authUrl: next.authUrl,
      };
      renderShell(currentInfo);
    });

    playback.onChange((next) => {
      currentInfo.playback = next;
      renderShell(currentInfo);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    playback.close();
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
  let playerBin: string;
  try {
    playerBin = locatePlayer();
  } catch (e) {
    process.stderr.write(`spotoei doctor: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // Doctor runs directly against the player child binary to produce
  // detailed keyring and account reporting.
  const result = spawnSync(playerBin, ['doctor', sub], { stdio: 'inherit' });
  return result.status ?? 0;
}

const code = await main();
process.exit(code);
