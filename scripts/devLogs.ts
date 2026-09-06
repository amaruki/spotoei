import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const path =
  process.env.SPOTOEI_LOG_FILE ??
  fileURLToPath(new URL('../target/dev/spotoei.log', import.meta.url));
mkdirSync(dirname(path), { recursive: true });
appendFileSync(path, '');
const tail = spawn('tail', ['-n', '50', '-F', path], { stdio: 'inherit' });
tail.on('error', (error) => {
  process.stderr.write(`${error.message}\nLog: ${path}\n`);
  process.exitCode = 1;
});
tail.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => tail.kill(signal));
