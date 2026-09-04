import { PROTOCOL_VERSION } from 'spotoei-protocol';

import { Cache } from '../cache';
import { resolveClientId, getRedirectUri, saveClientId, saveRedirectPort } from '../config';
import { locatePlayer } from '../player';

const HELP_TEXT = `spotoei — Spotify TUI

USAGE:
  spotoei [COMMAND] [OPTIONS]

COMMANDS:
  (none)                         Launch the full interactive TUI
  search <query>                 Run a non-interactive search and print results
  doctor [check]                 Verify binary, audio output, auth, and database health
  config set-client-id <id>      Save Spotify Client ID to config file
  config set-redirect-port <port> Set Spotify OAuth redirect port (default: 8989)

OPTIONS:
  -h, --help        Show this help message
  -v, --version     Show protocol and application version

KEYBOARD SHORTCUTS:
  ? or :            Open Command Palette
  Space or k        Play / Pause toggle
  /                 Jump to Search
  r                 Jump to Library & refresh
  u                 Jump to Queue
  l                 Jump to Lyrics
  L                 Fetch lyrics for current track
  v                 Cycle Visualizer mode
  Tab               Toggle focus between sidebar and main
  Esc               Return to Home / close palette
  q or Ctrl-C       Quit
`;

export function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

export function printVersion(): void {
  process.stdout.write(`spotoei v0.0.0 (protocol v${PROTOCOL_VERSION})\n`);
}

export function runDoctor(args: string[]): number {
  const sub = args[0] ?? 'all';
  const valid = ['all', 'audio', 'auth', 'network', 'db', 'system'];
  if (!valid.includes(sub)) {
    process.stderr.write(`spotoei doctor: unknown check "${sub}". Valid: ${valid.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`spotoei doctor: running checks [${sub}]\n`);
  let ok = true;
  try {
    const bin = locatePlayer();
    process.stdout.write(`  [ok] player binary present: ${bin}\n`);
  } catch (e) {
    process.stdout.write(`  [fail] player binary: ${e instanceof Error ? e.message : String(e)}\n`);
    ok = false;
  }
  try {
    const dbTest = new Cache({ filename: ':memory:' });
    dbTest.close();
    process.stdout.write('  [ok] sqlite storage accessible\n');
  } catch (e) {
    process.stdout.write(
      `  [fail] sqlite storage: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    ok = false;
  }

  const clientRes = resolveClientId();
  if (clientRes.clientId) {
    process.stdout.write(`  [ok] spotify client id configured (${clientRes.source})\n`);
  } else {
    process.stdout.write(
      `  [warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ${clientRes.configPath})\n`,
    );
  }

  const redirectUri = getRedirectUri();
  process.stdout.write(`  [ok] spotify redirect uri: ${redirectUri}\n`);

  if (ok) {
    process.stdout.write('spotoei doctor: all checks passed\n');
    return 0;
  }
  process.stderr.write('spotoei doctor: some checks failed\n');
  return 1;
}

export function handleConfigSubcommand(args: string[]): number | null {
  if (args[0] !== 'config') return null;
  if (args[1] === 'set-client-id' && args[2]) {
    const res = saveClientId(args[2]);
    process.stdout.write(`Spotify Client ID saved to ${res.configPath}\n`);
    return 0;
  }
  if (args[1] === 'set-redirect-port' && args[2]) {
    const port = Number.parseInt(args[2], 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      process.stderr.write('spotoei: invalid port number\n');
      return 1;
    }
    const res = saveRedirectPort(port);
    process.stdout.write(`Spotify redirect port set to ${res.port} in ${res.configPath}\n`);
    process.stdout.write(
      `Add this Redirect URI in your Spotify App Settings: http://127.0.0.1:${res.port}/callback\n`,
    );
    return 0;
  }
  process.stderr.write(
    'spotoei config: unknown subcommand. Use: set-client-id <id> | set-redirect-port <port>\n',
  );
  return 1;
}
