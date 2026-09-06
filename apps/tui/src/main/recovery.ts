import { diagnostic } from '../diagnostics';
/* eslint-disable no-await-in-loop -- A new session starts only after the previous session closes. */

export const RESTART_SESSION = 75;

// Recreate clients and subscriptions together with the child they own.
export async function recoverSessions(run: () => Promise<number>): Promise<number> {
  let exits: number[] = [];
  while (true) {
    const code = await run();
    if (code !== RESTART_SESSION) return code;
    const now = Date.now();
    exits = [...exits.filter((time) => now - time < 60_000), now];
    if (exits.length > 3) {
      diagnostic('runtime', 'player.restart_limit', { attempts: 3 });
      process.stderr.write(
        'Player unavailable: restart limit exceeded (3/60s). Run the application again to retry.\n',
      );
      return 1;
    }
    diagnostic('runtime', 'session.restart', { attempt: exits.length });
    process.stderr.write('Player exited. Restoring the application session…\n');
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (exits.length - 1)));
  }
}
