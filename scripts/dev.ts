import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getLogPath } from '../apps/tui/src/config';

// Keep the terminal descriptors intact. Workspace filters pipe output.
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.SPOTOEI_DEV = '1';
process.env.SPOTOEI_LOG_FILE ??= join(root, 'target', 'dev', 'spotoei.log');
process.env.SPOTOEI_PLAYER_BIN = join(
  root,
  'target',
  'debug',
  `spotoei-player${process.platform === 'win32' ? '.exe' : ''}`,
);
process.stderr.write(`[dev] Building Rust sidecar from ${root}\n`);
const build = spawnSync(
  'cargo',
  ['build', '--locked', '-p', 'spotoei-player', '--target-dir', join(root, 'target')],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (build.error || build.status !== 0) {
  process.stderr.write(
    `[dev/build] ${build.error?.message ?? `cargo exited with ${build.status}`}\n`,
  );
  process.exit(build.status ?? 1);
}
process.stderr.write(
  `[dev] Player: ${process.env.SPOTOEI_PLAYER_BIN}\n[dev] Diagnostics: ${getLogPath()} (bun dev:logs)\n`,
);
const { main } = await import('../apps/tui/src/main/index');
process.exitCode = await main(process.argv.slice(2));
