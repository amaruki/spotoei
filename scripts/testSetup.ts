import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Integration tests must never read, replace, or delete a developer session.
const testRoot = mkdtempSync(join(tmpdir(), 'spotoei-tests-'));
process.env.XDG_CONFIG_HOME = join(testRoot, 'config');
process.env.XDG_CACHE_HOME = join(testRoot, 'cache');
process.env.SPOTOEI_LOG_FILE = join(testRoot, 'tests.log');
process.env.SPOTOEI_AUTH_STORAGE = 'memory';
process.on('exit', () => rmSync(testRoot, { recursive: true, force: true }));
