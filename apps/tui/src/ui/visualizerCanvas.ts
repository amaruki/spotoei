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

// Persistent peak state across frames. Module-scope so successive draws see
// the previous frame's peak position; without it the caps would never fall.
const peakHeights: number[] = Array.from({ length: 32 }, () => 0);
const peakFallSpeed: number[] = Array.from({ length: 32 }, () => 0);

// Render frequency bins as a 32-bar spectrum with 1/8th vertical resolution
// and a gravity-falling peak cap above each bar.
export function drawBars(fb: OptimizedBufferLike, data: number[]): void {
  const bg = RGBA.fromHex(COLOR_PANEL_BG);
  fb.clear(bg);
  const w = fb.width;
  const h = fb.height;
  if (w <= 0 || h <= 0) return;

  const numBars = Math.min(w, 32);
  const barWidth = Math.max(1, Math.floor(w / numBars));
  const dataLen = data.length;

  for (let i = 0; i < numBars; i++) {
    let v = 0;
    if (dataLen > 0) {
      const start = Math.floor((i / numBars) * dataLen);
      const end = Math.max(start + 1, Math.floor(((i + 1) / numBars) * dataLen));
      let sum = 0;
      let count = 0;
      for (let k = start; k < Math.min(dataLen, end); k++) {
        sum += data[k] ?? 0;
        count++;
      }
      v = count > 0 ? sum / count : (data[start] ?? 0);
    }
    v = Math.max(0, Math.min(1, v));

    const totalEighths = Math.max(0, Math.min(h * 8, Math.round(v * (h * 8))));
    const fullRows = Math.floor(totalEighths / 8);
    const rem = totalEighths % 8;
    const x = i * barWidth;

    if (totalEighths >= (peakHeights[i] ?? 0)) {
      peakHeights[i] = totalEighths;
      peakFallSpeed[i] = 0;
    } else {
      peakFallSpeed[i] = (peakFallSpeed[i] ?? 0) + 0.4;
      peakHeights[i] = Math.max(0, (peakHeights[i] ?? 0) - (peakFallSpeed[i] ?? 0));
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

    const peakRow = Math.min(h - 1, Math.floor((peakHeights[i] ?? 0) / 8));
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
