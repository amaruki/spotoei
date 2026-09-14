import { describe, expect, it } from 'bun:test';
import type { LyricsDocumentT } from 'spotoei-protocol';
import {
  ANSI_ACTIVE,
  ANSI_DIM,
  calculateLyricsScrollOffset,
  centerLine,
  getActiveLyricIndex,
  renderLyricsContent,
  renderLyricsStyled,
  stripAnsi,
  visualLength,
} from '../src/ui/views/lyrics';
import { StyledText } from '@opentui/core';
import { processRtlText } from '../src/ui/views/rtl';
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
    lines: [{ text: 'Just plain lyrics' }, { text: 'Without any timestamps' }],
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

  it('renders synced lyrics with active line in primary color and inactive lines dimmed, without arrows or timestamps', () => {
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
    expect(lines[1]).toBe('Second line arrives');
    expect(lines[2]).toBe('Chorus hits high');
    expect(lines[3]).toBe('Outro fading away');

    // Strictly no arrow markers (▶, ◀, etc.) and no timestamps
    expect(plainOutput).not.toContain('▶');
    expect(plainOutput).not.toContain('◀');
    expect(plainOutput).not.toMatch(/\d+:\d\d/);

    // With ANSI contrast styling (primary color active, dim inactive)
    const ansiOutput = renderLyricsContent(mockState, { useAnsi: true });
    expect(ansiOutput).toContain(`${ANSI_ACTIVE}Second line arrives\x1b[0m`);
    expect(ansiOutput).toContain(`${ANSI_DIM}First verse starts\x1b[0m`);
    expect(ansiOutput).not.toContain('▶');
    expect(ansiOutput).not.toContain('◀');
    expect(ansiOutput).not.toMatch(/\d+:\d\d/);
  });

  it('renders native StyledText with COLOR_ACCENT for active and COLOR_DIM for inactive lines', () => {
    const mockState = {
      lyrics: syncedDoc,
      playback: {
        positionMs: 16000, // active line is index 1
      },
    } as Parameters<typeof renderLyricsStyled>[0];

    // Default windowSize: 9 (with 4-line fixture, all 4 lines shown)
    const styled = renderLyricsStyled(mockState, { width: 40 });
    expect(styled).toBeInstanceOf(StyledText);

    // Chunks alternate with separator: line0, \n, line1 (active), \n, line2, \n, line3
    const lineChunks = styled.chunks.filter((c) => c.text.trim() !== '');
    expect(lineChunks.length).toBe(4);

    // Inactive lines (line 0, 2, 3) must be dimmed
    expect(lineChunks[0]!.text).toContain('First verse starts');
    expect(lineChunks[0]!.attributes).toBe(0);
    expect(lineChunks[0]!.fg).toBeDefined();

    // Active line (line 1) must be styled in primary color (COLOR_ACCENT) and bold
    expect(lineChunks[1]!.text).toContain('Second line arrives');
    expect(lineChunks[1]!.attributes).toBe(1); // bold
    expect(lineChunks[1]!.fg).toBeDefined();
    // No arrow characters in any chunk
    for (const chunk of styled.chunks) {
      expect(chunk.text).not.toContain('▶');
      expect(chunk.text).not.toContain('◀');
    }
  });

  it('reduces inactive lines on screen by windowing lyrics around active line and supports vertical centering', () => {
    const longDoc: LyricsDocumentT = {
      kind: 'synced',
      lines: Array.from({ length: 20 }, (_, i) => ({
        startMs: i * 5000,
        text: `Lyric verse line ${i + 1}`,
      })),
    };

    const mockState = {
      lyrics: longDoc,
      playback: {
        positionMs: 50000, // active line is index 10
      },
    } as Parameters<typeof renderLyricsStyled>[0];

    // Default windowSize: 9 (4 before, active line 10, 4 after) with vertical padding for height 30
    const styled = renderLyricsStyled(mockState, { width: 60, height: 30 });
    const lineChunks = styled.chunks.filter((c) => c.text.trim() !== '');
    expect(lineChunks.length).toBe(9);
    expect(lineChunks[0]!.text).toContain('Lyric verse line 7');
    expect(lineChunks[4]!.text).toContain('Lyric verse line 11'); // active (index 10)
    expect(lineChunks[4]!.attributes).toBe(1); // bold
    expect(lineChunks[8]!.text).toContain('Lyric verse line 15');
    // Top padding exists for vertical center
    expect(styled.chunks[0]!.text).toMatch(/^\n+/);

    // windowSize: 5 can be explicitly requested
    const fiveLines = renderLyricsStyled(mockState, { windowSize: 5 });
    const fiveChunks = fiveLines.chunks.filter((c) => c.text.trim() !== '');
    expect(fiveChunks.length).toBe(5);

    // windowSize: 0 shows all lines when requested (e.g. manual scrolling mode)
    const allLinesStyled = renderLyricsStyled(mockState, { windowSize: 0 });
    const allLineChunks = allLinesStyled.chunks.filter((c) => c.text.trim() !== '');
    expect(allLineChunks.length).toBe(20);
  });
  it('centers lyrics horizontally when width is specified', () => {
    const mockState = {
      lyrics: syncedDoc,
      playback: {
        positionMs: 16000,
      },
    } as Parameters<typeof renderLyricsContent>[0];

    const width = 40;
    const output = renderLyricsContent(mockState, { width, useAnsi: false });
    const lines = output.split('\n');
    expect(lines.length).toBe(4);

    // Line 1: 'First verse starts' (18 chars) -> (40 - 18) / 2 = 11 spaces pad
    expect(lines[0]).toBe(' '.repeat(11) + 'First verse starts');

    // Active line: 'Second line arrives' -> centered (40 - 19) / 2 = 10 spaces pad
    expect(lines[1]).toBe(' '.repeat(10) + 'Second line arrives');
    expect(visualLength(lines[1]!)).toBe(29);
    // Helper centerLine direct verification
    expect(centerLine('Test', 10)).toBe('   Test');
    expect(centerLine('A very long lyric line that exceeds width', 20)).toBe(
      'A very long lyric line that exceeds width',
    );
    expect(stripAnsi('\x1b[1;32mHighlight\x1b[0m')).toBe('Highlight');
    expect(visualLength('Test')).toBe(4);
  });

  it('supports progress_ms directly in options or state', () => {
    const mockState = {
      lyrics: syncedDoc,
      playback: {
        progress_ms: 26000, // snake_case progress_ms -> index 2
      },
    } as unknown as Parameters<typeof renderLyricsContent>[0];

    const output = renderLyricsContent(mockState, { useAnsi: false });
    expect(output).toContain('Chorus hits high');
    expect(output).not.toContain('▶');

    // Override with explicit progressMs
    const override = renderLyricsContent(mockState, { progressMs: 42000, useAnsi: false });
    expect(override).toContain('Outro fading away');
    expect(override).not.toContain('▶');
  });

  it('centers plain un-synced lyrics when width is specified', () => {
    const mockState = {
      lyrics: plainDoc,
      playback: { positionMs: 10000 },
    } as Parameters<typeof renderLyricsContent>[0];

    const output = renderLyricsContent(mockState, { width: 40 });
    // 'Just plain lyrics' (17 chars) -> (40 - 17) / 2 = 11 spaces pad
    expect(output).toContain(' '.repeat(11) + 'Just plain lyrics');
    // 'Without any timestamps' (22 chars) -> (40 - 22) / 2 = 9 spaces pad
    expect(output).toContain(' '.repeat(9) + 'Without any timestamps');
    expect(output).not.toContain('▶');
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
  it('shapes Arabic characters and reorders RTL text for terminal output', () => {
    const rtlDoc: LyricsDocumentT = {
      kind: 'synced',
      lines: [
        { startMs: 1000, text: 'Easy come, easy go, will you let me go?' },
        { startMs: 5000, text: 'بِسْمِ اللَّهِ! No, we will not let you go' },
        { startMs: 10000, text: 'Will not let you go (let him go)' },
      ],
    };

    const mockState = {
      lyrics: rtlDoc,
      playback: { positionMs: 5500 },
    } as Parameters<typeof renderLyricsStyled>[0];

    const styled = renderLyricsStyled(mockState, { width: 60 });
    const lineChunks = styled.chunks.filter((c) => c.text.trim() !== '');
    expect(lineChunks.length).toBe(3);

    // Active line (index 1): Arabic letters are shaped (presentation forms)
    const activeLineText = lineChunks[1]!.text;
    // Contains shaped Arabic letters (from Presentation Forms-B range)
    expect(activeLineText).toMatch(/[\uFB50-\uFDFF\uFE70-\uFEFC]/);
    // English words remain in readable order
    expect(activeLineText).toContain('No, we will not let you go');

    // Direct helper check
    expect(processRtlText('Plain English')).toBe('Plain English');
    const bismillahProcessed = processRtlText('بِسْمِ اللَّهِ');
    expect(bismillahProcessed).toMatch(/[\uFE70-\uFEFC]/);
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
