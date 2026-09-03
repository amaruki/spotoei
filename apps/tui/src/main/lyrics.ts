import type { AppContext } from './types';

export function createLyricsActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const loadCurrentLyrics = async (force = false): Promise<void> => {
    const ui = getUi();
    if (!ui) return;
    const pb = state.currentInfo.playback;
    const track = pb?.track;
    if (!track || !track.uri) {
      ui.setLyrics(null);
      ui.setStatus('No track playing to load lyrics for');
      return;
    }

    if (!force && state.currentLyricsTrackUri === track.uri) {
      return;
    }

    state.currentLyricsTrackUri = track.uri;
    ui.setStatus(`Fetching lyrics for "${track.name}"…`);

    try {
      const doc = await clients.lyrics.loadLyrics({
        trackUri: track.uri,
        title: track.name,
        artist: Array.isArray(track.artists) ? track.artists[0] : undefined,
        album: track.album,
        durationMs: track.durationMs || pb.durationMs,
      });
      if (state.currentInfo.playback?.track?.uri === track.uri) {
        ui.setLyrics(doc);
        ui.setStatus(
          doc.kind === 'synced'
            ? `Loaded synced lyrics for "${track.name}" (${doc.lines.length} lines)`
            : `Loaded plain lyrics for "${track.name}"`,
        );
      }
    } catch {
      if (state.currentInfo.playback?.track?.uri === track.uri) {
        ui.setLyrics({
          kind: 'plain',
          lines: [{ text: `(Lyrics not found for "${track.name}")` }],
        });
        ui.setStatus(`Lyrics not found for "${track.name}"`);
      }
    }
  };

  return { loadCurrentLyrics };
}
