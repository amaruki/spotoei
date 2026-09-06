import { expect, it } from 'bun:test';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../src/config';
import { createAuthClient } from '../src/auth';
import { createPlaybackClient } from '../src/playback';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { recoverSessions, RESTART_SESSION } from '../src/main/recovery';

it('recreates command clients against the replacement Rust process', async () => {
  const pids: number[] = [];
  const result = await recoverSessions(async () => {
    const { child } = await startPlayer(locatePlayer(), {
      SPOTOEI_AUTH_STORAGE: 'memory',
      SPOTOEI_MOCK_PLAYER: '1',
    });
    pids.push(child.pid!);
    const auth = createAuthClient({ child });
    const playback = createPlaybackClient({ child });
    try {
      expect((await auth.status()).state).toBe('unauthenticated');
      expect((await playback.status()).state).toBe('idle');
      if (pids.length === 1) {
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.kill('SIGKILL');
        });
        return RESTART_SESSION;
      }
      return 0;
    } finally {
      auth.close();
      playback.close();
      await stopPlayer(child);
    }
  });
  expect(result).toBe(0);
  expect(pids).toHaveLength(2);
  expect(pids[0]).not.toBe(pids[1]);
});

it('bounds repeated session crashes to three restarts', async () => {
  let sessions = 0;
  expect(
    await recoverSessions(async () => {
      sessions++;
      return RESTART_SESSION;
    }),
  ).toBe(1);
  expect(sessions).toBe(4);
});

it('keeps disk sessions intact during memory-only authentication and logout', async () => {
  expect(process.env.SPOTOEI_AUTH_STORAGE).toBe('memory');
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'session.json');
  const sentinel = '{"fixture":"must survive test logout"}';
  writeFileSync(path, sentinel);
  const { child } = await startPlayer(locatePlayer(), { SPOTOEI_MOCK_AUTH: '1' });
  const auth = createAuthClient({ child });
  try {
    expect((await auth.status()).storage).toBe('memory');
    const authenticated = await auth.begin();
    expect(authenticated.scopes).toContain('user-top-read');
    expect(authenticated.scopes).toContain('user-read-recently-played');
    await auth.logout();
    expect(readFileSync(path, 'utf8')).toBe(sentinel);
  } finally {
    auth.close();
    await stopPlayer(child);
    rmSync(path);
  }
});
