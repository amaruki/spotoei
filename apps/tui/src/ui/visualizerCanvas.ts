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
  drawPeakCaps: boolean = true,
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

    if (!drawPeakCaps) continue;

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

// Sample the waveform at a column: average the source bucket when the
// samples are denser than the canvas, interpolate when they are sparser.
function sampleWaveAt(data: number[], x: number, width: number): number {
  const start = (x / width) * data.length;
  const end = ((x + 1) / width) * data.length;
  const lo = Math.floor(start);
  const hi = Math.max(lo + 1, Math.ceil(end));
  if (hi - lo <= 1) {
    const idx = Math.min(lo, data.length - 1);
    const frac = Math.min(1, Math.max(0, start - idx));
    const a = data[idx] ?? 0;
    const b = data[Math.min(idx + 1, data.length - 1)] ?? a;
    return a + (b - a) * frac;
  }
  let sum = 0;
  let count = 0;
  for (let k = lo; k < Math.min(hi, data.length); k++) {
    sum += data[k] ?? 0;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// Render the waveform as a connected polyline: one point per column with
// vertical segments joining consecutive points, over a faint center baseline.
// This reads like a real scope trace instead of a center-filled envelope.
export function drawWave(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex(COLOR_PANEL_BG);
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0 || data.length === 0) return;

  const center = Math.floor(h / 2);
  const baselineColor = RGBA.fromHex('#3a4252');
  const traceColor = RGBA.fromHex(COLOR_ACCENT);

  for (let x = 0; x < w; x++) {
    fb.setCell(x, center, '┄', baselineColor, bg);
  }

  let prevY: number | null = null;
  for (let x = 0; x < w; x++) {
    const v = Math.max(-1, Math.min(1, sampleWaveAt(data, x, w)));
    const y = Math.max(0, Math.min(h - 1, center - Math.round(v * ((h - 1) / 2))));

    if (prevY !== null && prevY !== y) {
      const from = Math.min(prevY, y);
      const to = Math.max(prevY, y);
      for (let yy = from; yy <= to; yy++) {
        fb.setCell(x, yy, '│', traceColor, bg);
      }
    }
    fb.setCell(x, y, '•', traceColor, bg);
    prevY = y;
  }
}

// Render a circular spectrum around a central hole reserved for cover art.
// Terminal cells are roughly twice as tall as wide, so the horizontal radius
// is doubled to keep the ring visually circular. `holeRows` is the diameter
// of the cover hole in rows.
export function drawCircular(fb: OptimizedBufferLike, data: number[], holeRows: number): void {
  const bg = RGBA.fromHex(COLOR_PANEL_BG);
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0 || data.length === 0) return;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.max(1, Math.min(Math.floor(cy), Math.floor(cx / 2)));
  const inner = Math.max(1, Math.min(holeRows, maxR - 2));
  const ringColor = RGBA.fromHex('#3a4252');

  // Faint frame just outside the cover hole.
  for (let a = 0; a < Math.PI * 2; a += 1 / (inner * 3)) {
    const x = Math.round(cx + Math.cos(a) * inner * 2);
    const y = Math.round(cy + Math.sin(a) * inner);
    if (x >= 0 && x < w && y >= 0 && y < h) {
      fb.setCell(x, y, '·', ringColor, bg);
    }
  }

  for (let i = 0; i < data.length; i++) {
    const v = Math.max(0, Math.min(1, data[i] ?? 0));
    if (v <= 0.001) continue;
    const angle = -Math.PI / 2 + (i / data.length) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const outer = inner + v * (maxR - inner);
    for (let r = inner; r <= outer; r += 0.5) {
      const x = Math.round(cx + cos * r * 2);
      const y = Math.round(cy + sin * r);
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      fb.setCell(x, y, '█', getBarColor(Math.round(r), maxR), bg);
    }
  }
}
