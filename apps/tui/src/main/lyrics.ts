import type { LyricsDocumentT } from 'spotoei-protocol';
import { getActiveLyricIndex, calculateLyricsScrollOffset } from '../ui/views/lyrics';
import type { AppContext } from './types';

export function calculateActiveLyricIndex(
  doc: LyricsDocumentT | null | undefined,
  progressMs: number,
): number {
  if (!doc || doc.kind !== 'synced' || !Array.isArray(doc.lines)) {
    return -1;
  }
  return getActiveLyricIndex(doc.lines, progressMs);
}
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
  const getActiveLyricLine = (
    progressMs?: number,
  ): { index: number; text: string; startMs?: number } | null => {
    const doc = state.currentInfo.lyrics;
    if (!doc) return null;
    if (doc.kind === 'plain') {
      // Un-synced fallback returns first line or null if empty
      return doc.lines[0] ? { index: 0, text: doc.lines[0].text } : null;
    }
    const curPos =
      progressMs ??
      (state.currentInfo.playback as { progress_ms?: number } | null | undefined)?.progress_ms ??
      state.currentInfo.playback?.positionMs ??
      0;
    const idx = getActiveLyricIndex(doc.lines, curPos);
    if (idx < 0 || !doc.lines[idx]) return null;
    return { index: idx, text: doc.lines[idx]!.text, startMs: doc.lines[idx]!.startMs };
  };

  const syncLyricsProgress = (
    progressMs?: number,
  ): { activeIndex: number; isSynced: boolean; scrollOffset: number } => {
    const doc = state.currentInfo.lyrics;
    if (!doc || doc.kind !== 'synced') {
      return { activeIndex: -1, isSynced: false, scrollOffset: 0 };
    }
    const curPos =
      progressMs ??
      (state.currentInfo.playback as { progress_ms?: number } | null | undefined)?.progress_ms ??
      state.currentInfo.playback?.positionMs ??
      0;
    const activeIndex = getActiveLyricIndex(doc.lines, curPos);
    const scrollOffset = calculateLyricsScrollOffset(activeIndex);
    return { activeIndex, isSynced: true, scrollOffset };
  };

  return { loadCurrentLyrics, getActiveLyricLine, syncLyricsProgress };
}
