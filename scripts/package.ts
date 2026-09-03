import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const VERSION = '0.0.0';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

console.log(`[package] Building SPOTOEI v${VERSION}...`);

if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

// Platform-specific binary names
const isWin = process.platform === 'win32';
const tuiBinName = isWin ? 'spotoei.exe' : 'spotoei';
const sidecarBinName = isWin ? 'spotoei-player.exe' : 'spotoei-player';

// 1. Build Rust release binary
console.log('[package] Compiling spotoei-player (Rust release)...');
const cargo = spawnSync('cargo', ['build', '--release', '-p', 'spotoei-player'], {
  stdio: 'inherit',
  cwd: ROOT,
});
if (cargo.status !== 0) {
  console.error('[package] cargo build failed');
  process.exit(1);
}

// 2. Build TS standalone binary
console.log('[package] Compiling spotoei (Bun standalone)...');
const bun = spawnSync(
  'bun',
  ['build', '--compile', 'apps/tui/src/main.ts', '--outfile', join(DIST, tuiBinName)],
  {
    stdio: 'inherit',
    cwd: ROOT,
  },
);
if (bun.status !== 0) {
  console.error('[package] bun build failed');
  process.exit(1);
}

// 3. Copy Rust player into dist (use fs, not cp).
const playerSrc = join(ROOT, 'target', 'release', sidecarBinName);
const playerDst = join(DIST, sidecarBinName);
try {
  copyFileSync(playerSrc, playerDst);
} catch (err: unknown) {
  console.error(
    `[package] failed to copy ${sidecarBinName} to dist: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

// 4. Generate SHA-256 checksums (use fs, not shasum).
const tuiBytes = readFileSync(join(DIST, tuiBinName));
const sidecarBytes = readFileSync(playerDst);
const tuiHash = createHash('sha256').update(tuiBytes).digest('hex');
const sidecarHash = createHash('sha256').update(sidecarBytes).digest('hex');

const lines: string[] = [];
lines.push(`${tuiHash}  ${tuiBinName}`);
lines.push(`${sidecarHash}  ${sidecarBinName}`);
writeFileSync(join(DIST, 'SHA256SUMS'), lines.join('\n') + '\n');

console.log(`[package] Build complete:`);
console.log(`  TUI:      ${join(DIST, tuiBinName)} (${tuiHash})`);
console.log(`  Sidecar:  ${playerDst} (${sidecarHash})`);
console.log(`  SHA256SUMS: ${join(DIST, 'SHA256SUMS')}`);
