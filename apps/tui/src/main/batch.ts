import type { SearchResponseT } from 'spotoei-protocol';

import { displayWidth, sanitize } from '../text';
import type { HandshakeResult } from '../player/types';
import type { PlaybackChangedDataT } from 'spotoei-protocol';
import type { Ui } from '../ui';
import type { AppClients, AppContext } from './types';

export async function runNonTtyMode(
  ctx: AppContext,
  args: string[],
  handshake: HandshakeResult,
  initialAuth: { state: string },
  initialPlayback: PlaybackChangedDataT,
  clients: AppClients,
  _ui: Ui | null,
): Promise<number> {
  if (args[0] === 'search' && args[1]) {
    const q = args.slice(1).join(' ');
    const res = await clients.searchClient.search(q);
    process.stdout.write(
      `spotoei search: "${sanitize(q)}" (${res.hits.length} hit${res.hits.length === 1 ? '' : 's'})\n`,
    );
    printSearchResults(res);
    await ctx.quit();
    return 0;
  }

  process.stdout.write('spotoei non-tty summary\n');
  process.stdout.write(`protocol: ${handshake.protocol}\n`);
  process.stdout.write(`player: ${handshake.playerVersion}\n`);
  process.stdout.write(`capabilities: ${handshake.capabilities.join(', ') || '(none)'}\n`);
  process.stdout.write(`auth: ${initialAuth.state}\n`);
  const trackName = initialPlayback.track?.name ?? '(idle)';
  process.stdout.write(
    `track: ${sanitize(trackName)} (display width: ${displayWidth(trackName)})\n`,
  );
  await ctx.quit();
  return 0;
}

export function handleCliSearch(q: string, clients: AppClients, ui: Ui | null): void {
  clients.searchClient
    .search(q)
    .then((res) => {
      if (ui) {
        ui.setRoute('search');
        ui.setSearchResults(q, res);
      }
    })
    .catch((e: unknown) => {
      if (ui) ui.setStatus(e instanceof Error ? e.message : String(e));
    });
}

function printSearchResults(res: SearchResponseT): void {
  for (const hit of res.hits) {
    if (hit.type === 'track') {
      const artists = hit.track.artists.map((a) => a.name).join(', ');
      process.stdout.write(`  [track] ${hit.track.name} — ${artists}\n`);
    } else if (hit.type === 'album') {
      const artists = hit.album.artists.map((a) => a.name).join(', ');
      process.stdout.write(`  [album] ${hit.album.name} — ${artists}\n`);
    } else if (hit.type === 'artist') {
      process.stdout.write(`  [artist] ${hit.artist.name}\n`);
    } else if (hit.type === 'playlist') {
      process.stdout.write(`  [playlist] ${hit.playlist.name}\n`);
    } else if (hit.type === 'show') {
      process.stdout.write(
        `  [show] ${hit.show.name}${hit.show.publisher ? ` — ${hit.show.publisher}` : ''}\n`,
      );
    } else if (hit.type === 'episode') {
      process.stdout.write(`  [episode] ${hit.episode.name}\n`);
    }
  }
}
