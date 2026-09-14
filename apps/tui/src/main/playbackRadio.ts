import type { CatalogTrackT } from 'spotoei-protocol';

import { logToFile } from '../config';
import type { PlaybackCore } from './playbackCore';
import type { AppContext } from './types';

export function createRadioActions(ctx: AppContext, core: PlaybackCore) {
  const { clients, state, getUi } = ctx;
  const { playTrackOrContext } = core;

  const playRadio = async (opts: { seedUri: string; title?: string }): Promise<void> => {
    const ui = getUi();
    const { seedUri, title } = opts;
    ui?.setStatus(`Starting radio for ${title ?? seedUri}…`);

    let tracks: CatalogTrackT[] = [];
    const isTrack = seedUri.startsWith('spotify:track:');
    const isArtist = seedUri.startsWith('spotify:artist:');
    const id = seedUri.split(':').pop();

    if (id) {
      try {
        if (isTrack) {
          tracks = await clients.webApi.getRecommendations({ seedTracks: [id], limit: 25 });
        } else if (isArtist) {
          tracks = await clients.webApi.getRecommendations({ seedArtists: [id], limit: 25 });
        }
      } catch (err) {
        logToFile(
          `[Radio Error] Failed recommendations: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (tracks.length === 0 && (isArtist || title)) {
      try {
        const query = title ? title.replace(/\s+Radio$/i, '') : (id ?? '');
        const searchHits = await clients.webApi.search(query, ['track'], 25);
        if (Array.isArray(searchHits)) {
          tracks = searchHits
            .filter(
              (h: unknown): h is Record<string, unknown> =>
                typeof h === 'object' && h !== null && ('type' in h || 'durationMs' in h),
            )
            .map((h) => ('type' in h && h.track ? h.track : h) as unknown as CatalogTrackT);
        }
      } catch (err) {
        logToFile(
          `[Radio Error] Fallback search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (tracks.length === 0) {
      ui?.setStatus(`No radio tracks found for ${title ?? seedUri}`, true);
      return;
    }

    state.activePlaylistTracks = tracks;
    const firstTrack = tracks[0];
    if (firstTrack?.uri) {
      await playTrackOrContext({
        trackUri: firstTrack.uri,
        title: firstTrack.name,
      });
      ui?.setStatus(`▶ Radio: ${title ?? firstTrack.name}`);
    }
  };

  return { playRadio };
}
