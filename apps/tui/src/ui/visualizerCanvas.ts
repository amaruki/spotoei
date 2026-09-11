import { RGBA } from '@opentui/core';
import { COLOR_ACCENT, COLOR_BAR_PEAK, COLOR_PANEL_BG } from './theme';

// Minimal subset of OpenTUI's optimized frame buffer API. Keeping our own
// interface lets us unit-test the canvas without spinning up a renderer.
export interface OptimizedBufferLike {
  width: number;
  height: number;
  clear(bg: RGBA): void;
  setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void;
}

// Unicode 1/8th blocks for sub-character vertical resolution in the bars.
const EIGHTH_BLOCKS = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

const MAX_BARS = 64;
const MAX_BAR_WIDTH = 4;

// Low bass -> treble peak. Used to gradient-color the bars from base to top.
const VIZ_COLORS = [
  RGBA.fromHex('#73daca'),
  RGBA.fromHex('#7aa2f7'),
  RGBA.fromHex('#89b4fa'),
  RGBA.fromHex('#bb9af7'),
  RGBA.fromHex('#c678dd'),
  RGBA.fromHex('#f7768e'),
  RGBA.fromHex('#ff9e64'),
];

function getBarColor(rowFromBottom: number, totalHeight: number): RGBA {
  const ratio = Math.max(0, Math.min(1, rowFromBottom / Math.max(1, totalHeight - 1)));
  const idx = Math.min(VIZ_COLORS.length - 1, Math.floor(ratio * VIZ_COLORS.length));
  return VIZ_COLORS[idx]!;
}

/** Resample band magnitudes to `target` values, averaging each source span. */
export function resampleBands(bands: number[], target: number): number[] {
  if (bands.length === 0 || target <= 0) return [];
  if (bands.length === target) return [...bands];
  const result: number[] = [];
  for (let i = 0; i < target; i++) {
    const start = Math.floor((i / target) * bands.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / target) * bands.length));
    let sum = 0;
    let count = 0;
    for (let k = start; k < Math.min(bands.length, end); k++) {
      sum += bands[k] ?? 0;
      count++;
    }
    result.push(count > 0 ? sum / count : (bands[start] ?? 0));
  }
  return result;
}

// Peak marker physics: pin the cap at its high-water mark for a short hold,
// then drop it with gravity. Time-based so the motion looks the same at 30
// and 60 FPS. Units are eighth-rows per second.
const PEAK_HOLD_MS = 500;
const PEAK_FALL_START = 20;
const PEAK_FALL_ACCEL = 60;
const PEAK_FALL_MAX = 96;

// Peak state lives in a per-canvas object rather than module scope so tests
// and multiple canvases cannot clobber each other's markers.
export interface PeakState {
  heights: number[];
  fallSpeed: number[];
  holdUntil: number[];
  lastDrawAt: number;
  lastBarCount: number;
}

export function createPeakState(): PeakState {
  return { heights: [], fallSpeed: [], holdUntil: [], lastDrawAt: 0, lastBarCount: -1 };
}

export function resetPeakState(state: PeakState): void {
  state.heights = [];
  state.fallSpeed = [];
  state.holdUntil = [];
  state.lastDrawAt = 0;
  state.lastBarCount = -1;
}

/**
 * Symmetric bar layout: 1 frequency band -> 1 bar, the whole group centered
 * on the canvas. When there are more bands than columns, bands are averaged
 * down to one bar per column so the frequency axis still reads left-to-right.
 */
export function barLayout(
  width: number,
  bandCount: number,
): { barWidth: number; gap: number; offset: number; barCount: number } {
  const barCount = bandCount > width ? width : bandCount;
  if (barCount <= 0) return { barWidth: 0, gap: 0, offset: 0, barCount: 0 };
  let gap = barCount > 1 ? 1 : 0;
  let barWidth = Math.floor((width - (barCount - 1) * gap) / barCount);
  if (barWidth < 1) {
    gap = 0;
    barWidth = Math.max(1, Math.floor(width / barCount));
  }
  barWidth = Math.min(barWidth, MAX_BAR_WIDTH);
  const groupWidth = barCount * barWidth + (barCount - 1) * gap;
  const offset = Math.max(0, Math.floor((width - groupWidth) / 2));
  return { barWidth, gap, offset, barCount };
}

export function drawBars(
  fb: OptimizedBufferLike,
  data: number[],
  state: PeakState,
  now: number = performance.now(),
): void {
  const bg = RGBA.fromHex(COLOR_PANEL_BG);
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0 || data.length === 0) return;

  const bandCount = Math.min(MAX_BARS, data.length);
  const layout = barLayout(w, bandCount);
  const { barWidth, gap, offset, barCount } = layout;
  if (barCount === 0 || barWidth === 0) return;

  const values = barCount === data.length ? data : resampleBands(data, barCount);
  if (barCount !== state.lastBarCount) {
    state.heights = Array.from({ length: barCount }, () => 0);
    state.fallSpeed = Array.from({ length: barCount }, () => 0);
    state.holdUntil = Array.from({ length: barCount }, () => 0);
    state.lastBarCount = barCount;
  }
  const stride = barWidth + gap;
  const dt = state.lastDrawAt > 0 ? Math.min(0.25, (now - state.lastDrawAt) / 1000) : 1 / 60;
  state.lastDrawAt = now;

  for (let i = 0; i < barCount; i++) {
    const v = Math.max(0, Math.min(1, values[i] ?? 0));

    const totalEighths = Math.max(0, Math.min(h * 8, Math.round(v * (h * 8))));
    const fullRows = Math.floor(totalEighths / 8);
    const rem = totalEighths % 8;
    const x = offset + i * stride;

    if (totalEighths >= (state.heights[i] ?? 0)) {
      state.heights[i] = totalEighths;
      state.fallSpeed[i] = 0;
      state.holdUntil[i] = now + PEAK_HOLD_MS;
    } else if (now >= (state.holdUntil[i] ?? 0)) {
      const speed = Math.max(
        PEAK_FALL_START,
        Math.min(PEAK_FALL_MAX, (state.fallSpeed[i] ?? 0) + PEAK_FALL_ACCEL * dt),
      );
      state.fallSpeed[i] = speed;
      state.heights[i] = Math.max(0, (state.heights[i] ?? 0) - speed * dt);
    }

    for (let y = 0; y < fullRows; y++) {
      const row = h - 1 - y;
      const color = getBarColor(y, h);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, row, '█', color, bg);
        }
      }
    }

    if (rem > 0 && fullRows < h) {
      const row = h - 1 - fullRows;
      const char = EIGHTH_BLOCKS[rem] ?? ' ';
      const color = getBarColor(fullRows, h);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, row, char, color, bg);
        }
      }
    }

    const peakRow = Math.min(h - 1, Math.floor((state.heights[i] ?? 0) / 8));
    if (peakRow > fullRows && peakRow < h) {
      const peakColor = RGBA.fromHex(COLOR_BAR_PEAK);
      for (let dx = 0; dx < barWidth; dx++) {
        if (x + dx < w) {
          fb.setCell(x + dx, h - 1 - peakRow, '▔', peakColor, bg);
        }
      }
    }
  }
}

// Render a centered oscilloscope (waveform) over a faint baseline.
export function drawWave(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex(COLOR_PANEL_BG);
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0 || data.length === 0) return;

  const center = Math.floor(h / 2);
  const centerColor = RGBA.fromHex('#3a4252');
  const wavePeakColor = RGBA.fromHex(COLOR_BAR_PEAK);
  const waveBodyColor = RGBA.fromHex(COLOR_ACCENT);

  for (let x = 0; x < w; x++) {
    fb.setCell(x, center, '┄', centerColor, bg);
  }

  for (let x = 0; x < w; x++) {
    const v = data[Math.floor((x / w) * data.length)] ?? 0;
    const offset = Math.round(v * ((h - 1) / 2));
    const targetY = Math.max(0, Math.min(h - 1, center - offset));

    const minY = Math.min(targetY, center);
    const maxY = Math.max(targetY, center);

    for (let y = minY; y <= maxY; y++) {
      const ch = y === targetY ? '●' : '│';
      const color = y === targetY ? wavePeakColor : waveBodyColor;
      fb.setCell(x, y, ch, color, bg);
    }
  }
}
