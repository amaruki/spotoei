import { createAuthClient } from '../auth';
import { resolveClientId } from '../config';
import { locatePlayer, startPlayer, stopPlayer } from '../player';
import { openBrowser } from '../system';

const noop = (): void => {};

async function waitForWebLogin(auth: ReturnType<typeof createAuthClient>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stop = auth.onStatusChange((status) => {
      if (status.state === 'authenticated') {
        stop();
        resolve();
      } else if (status.state === 'unauthenticated' || status.state === 'refresh-failed') {
        stop();
        reject(new Error('Spotify Web API authentication did not complete'));
      }
    });
  });
}

async function waitForStreamingLogin(auth: ReturnType<typeof createAuthClient>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopComplete = noop;
    let stopFailed = noop;
    let stopStatus = noop;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      stopComplete();
      stopFailed();
      stopStatus();
      if (error) reject(error);
      else resolve();
    };
    stopComplete = auth.onAuthCompleted((completed) => {
      if (!completed.streaming) return;
      finish();
    });
    stopFailed = auth.onAuthFailure((failure) => {
      finish(new Error(`Spotify streaming authentication failed: ${failure.message}`));
    });
    stopStatus = auth.onStatusChange((status) => {
      if (status.state !== 'authenticated') return;
      void auth
        .streamingStatus()
        .then((authenticated) => {
          if (authenticated) finish();
        })
        .catch(() => {});
    });
  });
}

async function openAuthorization(url: string): Promise<void> {
  if (!(await openBrowser(url))) {
    process.stdout.write(`Open this URL in a browser:\n${url}\n`);
  }
}

/** Force both OAuth approvals without starting the terminal UI. */
export async function runAuthenticate(): Promise<number> {
  const client = resolveClientId();
  if (!client.clientId) {
    process.stderr.write('spotoei authenticate: set a Spotify Client ID before authentication\n');
    return 1;
  }

  const handshake = await startPlayer(locatePlayer(), { SPOTOEI_CLIENT_ID: client.clientId });
  const auth = createAuthClient({ child: handshake.child, timeoutMs: 10_000 });
  try {
    await auth.logout();

    const webLogin = waitForWebLogin(auth);
    const web = await auth.begin();
    if (web.authUrl) await openAuthorization(web.authUrl);
    else if (web.state !== 'authenticated') {
      throw new Error('player did not provide a Web API authorization URL');
    }
    await webLogin;

    const streamingLogin = waitForStreamingLogin(auth);
    const streaming = await auth.beginStreaming();
    if (streaming.authUrl) await openAuthorization(streaming.authUrl);
    else if (streaming.state !== 'authenticated') {
      throw new Error('player did not provide a streaming authorization URL');
    }
    await streamingLogin;

    process.stdout.write('Spotify Web API and streaming authentication completed.\n');
    return 0;
  } catch (error) {
    process.stderr.write(
      `spotoei authenticate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    auth.close();
    await stopPlayer(handshake.child);
  }
}
