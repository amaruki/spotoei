import { describe, expect, it } from 'bun:test';
import type { LyricsDocumentT } from 'spotoei-protocol';
import {
  calculateLyricsScrollOffset,
  getActiveLyricIndex,
  renderLyricsContent,
} from '../src/ui/views/lyrics';
import { calculateActiveLyricIndex, createLyricsActions } from '../src/main/lyrics';
import type { AppContext } from '../src/main/types';

describe('Real-time lyrics tracking & rendering', () => {
  const syncedDoc: LyricsDocumentT = {
    kind: 'synced',
    lines: [
      { startMs: 5000, text: 'First verse starts' },
      { startMs: 15000, text: 'Second line arrives' },
      { startMs: 25000, text: 'Chorus hits high' },
      { startMs: 40000, text: 'Outro fading away' },
    ],
  };

  const plainDoc: LyricsDocumentT = {
    kind: 'plain',
    lines: [
      { text: 'Just plain lyrics' },
      { text: 'Without any timestamps' },
    ],
  };

  it('calculates active lyric index based on progress_ms accurately', () => {
    // Before any lyric starts
    expect(getActiveLyricIndex(syncedDoc.lines, 0)).toBe(-1);
    expect(getActiveLyricIndex(syncedDoc.lines, 4999)).toBe(-1);

    // Exact first line start
    expect(getActiveLyricIndex(syncedDoc.lines, 5000)).toBe(0);

    // Between first and second line
    expect(getActiveLyricIndex(syncedDoc.lines, 10000)).toBe(0);

    // Exactly at second line
    expect(getActiveLyricIndex(syncedDoc.lines, 15000)).toBe(1);

    // In chorus
    expect(getActiveLyricIndex(syncedDoc.lines, 30000)).toBe(2);

    // Beyond last line
    expect(getActiveLyricIndex(syncedDoc.lines, 60000)).toBe(3);
  });

  it('calculates auto-centered scroll offset correctly', () => {
    // Negative index (intro)
    expect(calculateLyricsScrollOffset(-1, 10)).toBe(0);

    // Near start (activeIdx < half viewport)
    expect(calculateLyricsScrollOffset(2, 10)).toBe(0);

    // Past half viewport (activeIdx 7 with viewport 10 -> 7 - 5 = 2)
    expect(calculateLyricsScrollOffset(7, 10)).toBe(2);
    expect(calculateLyricsScrollOffset(12, 10)).toBe(7);
  });

  it('renders synced lyrics with active line indicator and contrast styling', () => {
    const mockState = {
      lyrics: syncedDoc,
      playback: {
        positionMs: 16000, // active line is index 1
      },
    } as Parameters<typeof renderLyricsContent>[0];

    // Without ANSI (plain test mode)
    const plainOutput = renderLyricsContent(mockState, { useAnsi: false });
    const lines = plainOutput.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe('  0:05  First verse starts');
    expect(lines[1]).toBe('▶ 0:15  Second line arrives');
    expect(lines[2]).toBe('  0:25  Chorus hits high');
    expect(lines[3]).toBe('  0:40  Outro fading away');

    // With ANSI contrast styling
    const ansiOutput = renderLyricsContent(mockState, { useAnsi: true });
    expect(ansiOutput).toContain('\x1b[1;97m▶ 0:15  Second line arrives\x1b[0m');
    expect(ansiOutput).toContain('\x1b[2;90m  0:05  First verse starts\x1b[0m');
  });

  it('supports progress_ms directly in options or state', () => {
    const mockState = {
      lyrics: syncedDoc,
      playback: {
        progress_ms: 26000, // snake_case progress_ms -> index 2
      },
    } as unknown as Parameters<typeof renderLyricsContent>[0];

    const output = renderLyricsContent(mockState, { useAnsi: false });
    expect(output).toContain('▶ 0:25  Chorus hits high');

    // Override with explicit progressMs
    const override = renderLyricsContent(mockState, { progressMs: 42000, useAnsi: false });
    expect(override).toContain('▶ 0:40  Outro fading away');
  });

  it('renders fallback un-synced plain lyrics smoothly', () => {
    const mockState = {
      lyrics: plainDoc,
      playback: { positionMs: 10000 },
    } as Parameters<typeof renderLyricsContent>[0];

    const output = renderLyricsContent(mockState);
    expect(output).toContain('Just plain lyrics');
    expect(output).toContain('Without any timestamps');
    expect(output).not.toContain('▶');
  });

  it('calculates active lyric index in main lyrics helpers', () => {
    expect(calculateActiveLyricIndex(syncedDoc, 15500)).toBe(1);
    expect(calculateActiveLyricIndex(plainDoc, 15500)).toBe(-1);
    expect(calculateActiveLyricIndex(null, 15500)).toBe(-1);
  });

  it('syncs lyrics progress in createLyricsActions', () => {
    const mockUi = {
      setLyrics: () => {},
      setStatus: () => {},
    };

    const ctx = {
      clients: {
        lyrics: {
          loadLyrics: async () => syncedDoc,
        },
      },
      state: {
        currentInfo: {
          lyrics: syncedDoc,
          playback: { positionMs: 25500 },
        },
      },
      getUi: () => mockUi,
    } as unknown as AppContext;

    const actions = createLyricsActions(ctx);
    const sync = actions.syncLyricsProgress();
    expect(sync.isSynced).toBe(true);
    expect(sync.activeIndex).toBe(2);

    const activeLine = actions.getActiveLyricLine();
    expect(activeLine).toEqual({
      index: 2,
      text: 'Chorus hits high',
      startMs: 25000,
    });
  });
});
