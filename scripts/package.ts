import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const VERSION = '0.0.0';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

console.log(`[package] Building SPOTOEI v${VERSION}...`);

if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

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
const bun = spawnSync('bun', ['build', '--compile', 'apps/tui/src/main.ts', '--outfile', join(DIST, 'spotoei')], {
  stdio: 'inherit',
  cwd: ROOT,
});
if (bun.status !== 0) {
  console.error('[package] bun build failed');
  process.exit(1);
}

// 3. Copy Rust player into dist
const playerSrc = join(ROOT, 'target', 'release', 'spotoei-player');
const playerDst = join(DIST, 'spotoei-player');
const cp = spawnSync('cp', [playerSrc, playerDst]);
if (cp.status !== 0) {
  console.error('[package] failed to copy spotoei-player to dist');
  process.exit(1);
}

// 4. Create release tarball
const os = process.platform;
const arch = process.arch;
const archiveName = `spotoei-v${VERSION}-${os}-${arch}.tar.gz`;
const archivePath = join(DIST, archiveName);

console.log(`[package] Creating archive ${archiveName}...`);
const tar = spawnSync('tar', ['-czf', archivePath, '-C', DIST, 'spotoei', 'spotoei-player']);
if (tar.status !== 0) {
  console.error('[package] tar creation failed');
  process.exit(1);
}

// 5. Generate SHA256SUMS
console.log('[package] Generating SHA256SUMS...');
const hash = createHash('sha256');
const data = readFileSync(archivePath);
hash.update(data);
const digest = hash.digest('hex');
const checksumLine = `${digest}  ${archiveName}\n`;
writeFileSync(join(DIST, 'SHA256SUMS'), checksumLine);

console.log(`[package] Build and packaging complete:`);
console.log(`  Archive:  ${archivePath}`);
console.log(`  Checksum: ${digest}`);
