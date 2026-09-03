import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Locate the spotoei-player binary.
 *
 * Order of resolution:
 *   1. SPOTOEI_PLAYER_BIN env var (must be absolute and must exist).
 *   2. Packaged candidates alongside process.execPath
 *      (`spotoei-player`, `libexec/spotoei-player`, `../libexec/spotoei-player`,
 *      `../spotoei-player`).
 *   3. Dev candidates at `<repoRoot>/target/{debug,release}/spotoei-player`
 *      when running from source via Bun.
 *   4. Bare PATH lookup `spotoei-player` is allowed only in dev / test
 *      environments; production must always resolve to a concrete file.
 */
export function locatePlayer(): string {
  const override = process.env.SPOTOEI_PLAYER_BIN;
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(`SPOTOEI_PLAYER_BIN must be an absolute path: ${override}`);
    }
    if (!existsSync(override)) {
      throw new Error(`SPOTOEI_PLAYER_BIN not found: ${override}`);
    }
    return realpathSync(override);
  }

  // In development and test runs (invoked through `bun test` or `bun run`),
  // `import.meta.url` points to the real source file path. In standalone
  // compiled binaries, Bun embeds code at `$bunfs/...`, so we must inspect
  // both `process.execPath` and the module URL's directory.
  const fileDir = (() => {
    try {
      const u = new URL(import.meta.url);
      if (u.protocol === 'file:') return dirname(u.pathname);
    } catch {
      // ignore
    }
    return dirname(realpathSync(process.execPath));
  })();
  const execDir = dirname(realpathSync(process.execPath));

  const packagedCandidates = [
    join(execDir, 'spotoei-player'),
    join(execDir, 'libexec', 'spotoei-player'),
    join(execDir, '..', 'libexec', 'spotoei-player'),
    join(execDir, '..', 'spotoei-player'),
  ];
  for (const c of packagedCandidates) {
    if (existsSync(c)) {
      return realpathSync(c);
    }
  }

  const repoRoot = resolve(fileDir, '..', '..', '..', '..');
  const devCandidates = [
    join(repoRoot, 'target', 'debug', 'spotoei-player'),
    join(repoRoot, 'target', 'release', 'spotoei-player'),
  ];
  for (const c of devCandidates) {
    if (existsSync(c)) {
      return realpathSync(c);
    }
  }

  // Refuse bare PATH fallback in production to avoid executing a hijacked binary.
  const isDev = process.env.NODE_ENV !== 'production' || process.env.SPOTOEI_DEV === '1';
  if (isDev) {
    return 'spotoei-player';
  }

  throw new Error(
    'spotoei-player binary not found; build it with cargo build or set SPOTOEI_PLAYER_BIN',
  );
}
