import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

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

// 4. Stage archive contents: license, README, and both binaries.
const platform =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : process.arch;
const archiveName = `spotoei-v${VERSION}-${platform}-${arch}.tar.gz`;
const archivePath = join(DIST, archiveName);
const stage = join(DIST, `.stage-${platform}-${arch}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const file of ['LICENSE', 'README.md']) {
  copyFileSync(join(ROOT, file), join(stage, file));
}
copyFileSync(join(DIST, tuiBinName), join(stage, tuiBinName));
copyFileSync(playerDst, join(stage, sidecarBinName));

// 5. Create the versioned archive.
const tar = spawnSync('tar', ['-czf', archivePath, '-C', stage, '.'], { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
if (tar.status !== 0) {
  console.error('[package] tar failed');
  process.exit(1);
}

// 6. Checksums cover the archive.
const archiveHash = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
writeFileSync(join(DIST, 'SHA256SUMS'), `${archiveHash}  ${archiveName}\n`);

console.log(`[package] Build complete:`);
console.log(`  TUI:      ${join(DIST, tuiBinName)}`);
console.log(`  Sidecar:  ${playerDst}`);
console.log(`  Archive:  ${archivePath}`);
console.log(`  SHA256SUMS: ${join(DIST, 'SHA256SUMS')} (${archiveHash})`);
