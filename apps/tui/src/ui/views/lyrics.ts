import { StyledText, fg, bold, stripAnsiSequences, type TextChunk } from '@opentui/core';
import { COLOR_ACCENT, COLOR_DIM } from '../theme';
import { processRtlText, visualLength as rtlVisualLength } from './rtl';
import type { UiViewState } from '../types';
export function binarySearchLastLE(
  lines: Array<{ startMs: number }>,
  positionMs: number,
): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = lines[mid]!.startMs;
    if (v <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function getActiveLyricIndex(
  lines: Array<{ startMs: number }>,
  progressMs: number,
): number {
  if (!lines || lines.length === 0 || progressMs < (lines[0]?.startMs ?? 0)) {
    return -1;
  }
  return binarySearchLastLE(lines, progressMs);
}

export function calculateLyricsScrollOffset(
  activeIdx: number,
  viewportHeight = 10,
): number {
  if (activeIdx < 0) return 0;
  return Math.max(0, activeIdx - Math.floor(viewportHeight / 2));
}
export interface LyricsRenderOptions {
  progressMs?: number;
  useAnsi?: boolean;
  autoCenter?: boolean;
  viewportHeight?: number;
  width?: number;
  height?: number;
  windowSize?: number;
  lineSpacing?: number;
}

export const ANSI_ACTIVE = '\x1b[1;32m';
export const ANSI_DIM = '\x1b[2;90m';
export const ANSI_RESET = '\x1b[0m';
export const stripAnsi = stripAnsiSequences;


export function visualLength(text: string): number {
  return rtlVisualLength(stripAnsi(text));
}

export function centerLine(text: string, width: number): string {
  if (!width || width <= 0) return text;
  const visibleLen = visualLength(text);
  if (visibleLen >= width) return text;
  const pad = Math.max(0, Math.floor((width - visibleLen) / 2));
  return ' '.repeat(pad) + text;
}
export function renderLyricsContent(
  state: UiViewState,
  opts?: LyricsRenderOptions,
): string {
  const doc = state.lyrics;
  if (!doc) {
    return '(no lyrics loaded — press l to view, L to reload)';
  }
  const lineSpacing = opts?.lineSpacing ?? 1;
  const separator = '\n'.repeat(lineSpacing);

  if (doc.kind === 'plain') {
    if (doc.lines.length === 0) {
      return '(no plain lyrics text)';
    }
    const targetWidth = opts?.width;
    const plainLines = doc.lines.map((l) => processRtlText(l.text.trim())).filter(Boolean);
    return plainLines
      .map((line) => (targetWidth && targetWidth > 0 ? centerLine(line, targetWidth) : line))
      .join(separator === '\n' ? '\n\n' : separator);
  }

  const curPos =
    opts?.progressMs ??
    (state.playback as { progress_ms?: number } | null | undefined)?.progress_ms ??
    state.playback?.positionMs ??
    0;
  const activeIdx = getActiveLyricIndex(doc.lines, curPos);
  const useAnsi = opts?.useAnsi ?? false;

  let targetLines = doc.lines.map((l, i) => ({ line: l, originalIndex: i }));

  const windowSize = opts?.windowSize;
  if (windowSize && windowSize > 0 && doc.lines.length > windowSize) {
    const effectiveActive = activeIdx >= 0 ? activeIdx : 0;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(0, effectiveActive - half);
    let end = start + windowSize;
    if (end > doc.lines.length) {
      end = doc.lines.length;
      start = Math.max(0, end - windowSize);
    }
    targetLines = targetLines.slice(start, end);
  } else if (opts?.autoCenter && opts.viewportHeight && opts.viewportHeight > 0) {
    const half = Math.floor(opts.viewportHeight / 2);
    const start = Math.max(0, (activeIdx >= 0 ? activeIdx : 0) - half);
    const end = Math.min(doc.lines.length, start + opts.viewportHeight);
    targetLines = targetLines.slice(start, end);
  }

  const targetWidth = opts?.width;
  let topPadStr = '';
  if (opts?.height && opts.height > 0) {
    const availHeight = Math.max(6, opts.height - 10);
    const totalContentRows = targetLines.length + (targetLines.length - 1) * (lineSpacing - 1);
    const topPad = Math.max(0, Math.floor((availHeight - totalContentRows) / 2));
    if (topPad > 0) {
      topPadStr = '\n'.repeat(topPad);
    }
  }

  return (
    topPadStr +
    targetLines
      .map(({ line: l, originalIndex: i }) => {
        const isActive = i === activeIdx;
        const rawClean = l.text.trim();
        const cleanText = processRtlText(rawClean);
        const displayText = cleanText;
        const centered =
          targetWidth && targetWidth > 0 ? centerLine(displayText, targetWidth) : displayText;
        if (!useAnsi) {
          return centered;
        }
        return isActive
          ? `${ANSI_ACTIVE}${centered}${ANSI_RESET}`
          : `${ANSI_DIM}${centered}${ANSI_RESET}`;
      })
      .join(separator)
  );
}

export function renderLyricsStyled(
  state: UiViewState,
  opts?: LyricsRenderOptions,
): StyledText {
  const doc = state.lyrics;
  if (!doc) {
    return new StyledText([fg(COLOR_DIM)('(no lyrics loaded — press l to view, L to reload)')]);
  }
  const lineSpacing = opts?.lineSpacing ?? 1;
  const separator = '\n'.repeat(lineSpacing);

  if (doc.kind === 'plain') {
    if (doc.lines.length === 0) {
      return new StyledText([fg(COLOR_DIM)('(no plain lyrics text)')]);
    }
    const targetWidth = opts?.width;
    const chunks: TextChunk[] = [];
    const plainLines = doc.lines.map((l) => processRtlText(l.text.trim())).filter(Boolean);
    plainLines.forEach((line, idx) => {
      if (idx > 0) {
        chunks.push({ __isChunk: true, text: separator } as TextChunk);
      }
      const centered = targetWidth && targetWidth > 0 ? centerLine(line, targetWidth) : line;
      chunks.push(fg(COLOR_DIM)(centered));
    });
    return new StyledText(chunks);
  }

  const curPos =
    opts?.progressMs ??
    (state.playback as { progress_ms?: number } | null | undefined)?.progress_ms ??
    state.playback?.positionMs ??
    0;
  const activeIdx = getActiveLyricIndex(doc.lines, curPos);

  let targetLines = doc.lines.map((l, i) => ({ line: l, originalIndex: i }));

  const windowSize = opts?.windowSize ?? 9;
  if (windowSize > 0 && doc.lines.length > windowSize) {
    const effectiveActive = activeIdx >= 0 ? activeIdx : 0;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(0, effectiveActive - half);
    let end = start + windowSize;
    if (end > doc.lines.length) {
      end = doc.lines.length;
      start = Math.max(0, end - windowSize);
    }
    targetLines = targetLines.slice(start, end);
  } else if (opts?.autoCenter && opts.viewportHeight && opts.viewportHeight > 0) {
    const half = Math.floor(opts.viewportHeight / 2);
    const start = Math.max(0, (activeIdx >= 0 ? activeIdx : 0) - half);
    const end = Math.min(doc.lines.length, start + opts.viewportHeight);
    targetLines = targetLines.slice(start, end);
  }

  const targetWidth = opts?.width;
  const chunks: TextChunk[] = [];

  if (opts?.height && opts.height > 0) {
    const availHeight = Math.max(9, opts.height - 10);
    const totalContentRows = targetLines.length + (targetLines.length - 1) * (lineSpacing - 1);
    const topPad = Math.max(0, Math.floor((availHeight - totalContentRows) / 2));
    if (topPad > 0) {
      chunks.push({ __isChunk: true, text: '\n'.repeat(topPad) } as TextChunk);
    }
  }

  targetLines.forEach(({ line: l, originalIndex: i }, idx) => {
    if (idx > 0) {
      chunks.push({ __isChunk: true, text: separator } as TextChunk);
    }
    const isActive = i === activeIdx;
    const rawClean = l.text.trim();
    const cleanText = processRtlText(rawClean);
    const displayText = cleanText;
    const centered =
      targetWidth && targetWidth > 0 ? centerLine(displayText, targetWidth) : displayText;
    if (isActive) {
      chunks.push(fg(COLOR_ACCENT)(bold(centered)));
    } else {
      chunks.push(fg(COLOR_DIM)(centered));
    }
  });
  return new StyledText(chunks);
}
