import { spawnSync } from 'node:child_process';
import { PROTOCOL_VERSION } from 'spotoei-protocol';

import { Cache, defaultCachePath } from '../cache';
import { getCacheDir, getConfigDir } from '../config';
import { resolveClientId, getRedirectUri, saveClientId, saveRedirectPort } from '../config';
import { locatePlayer } from '../player';

const HELP_TEXT = `spotoei — Spotify TUI

USAGE:
  spotoei [COMMAND] [OPTIONS]

COMMANDS:
  (none)                         Launch the full interactive TUI
  search <query>                 Run a non-interactive search and print results
  authenticate                   Force fresh Spotify Web API and streaming logins
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
  let playerBin: string | null = null;
  try {
    const bin = locatePlayer();
    playerBin = bin;
    process.stdout.write(`  [ok] player binary present: ${bin}\n`);
  } catch (e) {
    process.stdout.write(`  [fail] player binary: ${e instanceof Error ? e.message : String(e)}\n`);
    ok = false;
  }
  if (sub === 'all' || sub === 'audio' || sub === 'system') {
    if (playerBin) {
      try {
        const res = spawnSync(playerBin, ['doctor', 'audio'], { timeout: 5000, encoding: 'utf8' });
        const out = (res.stdout ?? '').trim().split('\n').pop() ?? '';
        if (res.status === 0) process.stdout.write(`  [ok] audio backend: ${out || 'available'}\n`);
        else process.stdout.write('  [warn] audio backend check reported issues\n');
      } catch (e) {
        process.stdout.write(`  [warn] audio backend: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    } else process.stdout.write('  [warn] audio backend: player binary not found, skipping\n');
  }
  if (sub === 'all' || sub === 'db' || sub === 'system') {
    try {
      const mem = new Cache({ filename: ':memory:' });
      mem.close();
      process.stdout.write('  [ok] sqlite storage accessible\n');
    } catch (e) {
      process.stdout.write(`  [fail] sqlite storage: ${e instanceof Error ? e.message : String(e)}\n`);
      ok = false;
    }
    try {
      const cachePath = defaultCachePath();
      const c = new Cache();
      const integrity = c.checkIntegrity();
      const ver = c.getSchemaVersion();
      c.close();
      if (integrity) process.stdout.write(`  [ok] cache file integrity ok (schema v${ver}, ${cachePath})\n`);
      else { process.stdout.write(`  [warn] cache file integrity check failed (${cachePath})\n`); ok = false; }
    } catch (e) {
      process.stdout.write(`  [warn] cache file: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    try {
      const dir = getCacheDir();
      const cfgDir = getConfigDir();
      process.stdout.write(`  [ok] cache dir: ${dir}\n`);
      process.stdout.write(`  [ok] config dir: ${cfgDir}\n`);
    } catch (e) {
      process.stdout.write(`  [warn] cache/config dir: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  if (sub === 'all' || sub === 'auth' || sub === 'system') {
    const clientRes = resolveClientId();
    if (clientRes.clientId) process.stdout.write(`  [ok] spotify client id configured (${clientRes.source})\n`);
    else process.stdout.write(`  [warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ${clientRes.configPath})\n`);
    const redirectUri = getRedirectUri();
    process.stdout.write(`  [ok] spotify redirect uri: ${redirectUri}\n`);
    try {
      const candidates: string[] = process.platform === 'darwin' ? ['security'] : process.platform === 'win32' ? ['cmd'] : ['secret-tool', 'gnome-keyring'];
      let found = false;
      for (const cand of candidates) {
        const r = spawnSync('which', [cand], { encoding: 'utf8' });
        if (r.status === 0) { found = true; break; }
      }
      if (found || process.platform === 'darwin' || process.platform === 'win32') process.stdout.write('  [ok] keyring backend available\n');
      else process.stdout.write('  [warn] keyring backend: no secret-tool/gnome-keyring found (will fallback to file)\n');
    } catch {
      process.stdout.write('  [warn] keyring backend check failed\n');
    }
  } else {
    const clientRes = resolveClientId();
    if (clientRes.clientId) process.stdout.write(`  [ok] spotify client id configured (${clientRes.source})\n`);
    else process.stdout.write(`  [warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ${clientRes.configPath})\n`);
    const redirectUri = getRedirectUri();
    process.stdout.write(`  [ok] spotify redirect uri: ${redirectUri}\n`);
  }
  if (sub === 'all' || sub === 'system' || sub === 'network') {
    const candidates: string[] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['rundll32'] : ['xdg-open', 'sensible-browser', 'wslview'];
    let found: string | null = null;
    for (const c of candidates) {
      const r = spawnSync('which', [c], { encoding: 'utf8' });
      if (r.status === 0) { found = c; break; }
    }
    if (found) process.stdout.write(`  [ok] browser launcher available: ${found}\n`);
    else process.stdout.write('  [warn] browser launcher: no known opener on PATH\n');
    if (sub === 'network' || sub === 'all') process.stdout.write('  [ok] network: dns check skipped (auth will verify Spotify API)\n');
  }
  if (playerBin) {
    try {
      const res = spawnSync(playerBin, ['doctor', 'all'], { timeout: 8000, encoding: 'utf8' });
      if (res.stdout) process.stdout.write(`  --- spotoei-player doctor output ---\n${res.stdout}`);
      if (res.stderr) process.stderr.write(res.stderr);
      if (res.status !== 0) process.stdout.write('  [warn] spotoei-player doctor reported issues (see above)\n');
      else process.stdout.write('  [ok] spotoei-player doctor passed\n');
    } catch (e) {
      process.stdout.write(`  [warn] spotoei-player doctor: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  } else process.stdout.write('  [info] spotoei-player doctor: skipped (binary not found)\n');
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
