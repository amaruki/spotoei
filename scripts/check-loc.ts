#!/usr/bin/env bun
/**
 * SpotOEI Line-Count Enforcement Gate
 * Ensures every production file is strictly under 300 LoC.
 * See: docs/TSD/09-coding-standards.md Section 6.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_LOC = 300;
const DIRS = ['apps', 'crates', 'packages'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.rs', '.js']);
const EXCLUDE_DIRS = new Set(['node_modules', 'target', 'dist', '.git']);

let failed = false;

async function checkFile(fullPath: string): Promise<void> {
  const content = await readFile(fullPath, 'utf-8');
  const lines = content.split('\n').length;
  if (lines > MAX_LOC) {
    console.error(`❌ ${fullPath}: ${lines} lines (exceeds ${MAX_LOC} LoC ceiling)`);
    failed = true;
  }
}

async function checkDir(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  const tasks: Promise<void>[] = [];

  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      tasks.push(checkDir(fullPath));
    } else if (entry.isFile()) {
      const ext = fullPath.slice(fullPath.lastIndexOf('.'));
      if (!EXTENSIONS.has(ext)) continue;
      if (fullPath.includes('.test.') || fullPath.includes('__tests__')) continue;
      tasks.push(checkFile(fullPath));
    }
  }

  await Promise.all(tasks);
}

await Promise.all(DIRS.map((dir) => checkDir(dir)));

if (failed) {
  console.error(
    `\nFound files exceeding ${MAX_LOC} LoC. See docs/TSD/09-coding-standards.md Section 6.`,
  );
  process.exit(1);
} else {
  console.log(`✅ All production files are under ${MAX_LOC} LoC.`);
}
