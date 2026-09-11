import { describe, expect, it } from 'bun:test';
import { RGBA } from '@opentui/core';
import {
  barLayout,
  createPeakState,
  drawBars,
  drawWave,
  type OptimizedBufferLike,
} from '../src/ui/visualizerCanvas';

interface FakeFb extends OptimizedBufferLike {
  cells: Map<string, string>;
}

function makeFb(width: number, height: number): FakeFb {
  const cells = new Map<string, string>();
  return {
    width,
    height,
    cells,
    clear: () => cells.clear(),
    setCell: (x, y, ch) => {
      if (x >= 0 && x < width && y >= 0 && y < height) cells.set(`${x},${y}`, ch);
    },
  };
}

function paintedColumns(fb: FakeFb): number[] {
  const cols = new Set<number>();
  for (const key of fb.cells.keys()) {
    cols.add(Number(key.split(',')[0]));
  }
  return [...cols].toSorted((a, b) => a - b);
}

function markerRows(fb: FakeFb): number[] {
  const rows = new Set<number>();
  for (const [key, ch] of fb.cells) {
    if (ch === '▔') rows.add(Number(key.split(',')[1]));
  }
  return [...rows].toSorted((a, b) => a - b);
}

const BANDS_64 = Array.from({ length: 64 }, (_, i) => 0.2 + (i / 63) * 0.8);

describe('visualizer canvas layout', () => {
  it('keeps 1 band per bar and centers the group on wide canvases', () => {
    expect(barLayout(104, 64)).toEqual({ barWidth: 1, gap: 0, offset: 20, barCount: 64 });
    expect(barLayout(200, 64)).toEqual({ barWidth: 2, gap: 1, offset: 4, barCount: 64 });
  });

  it('collapses bands to columns on narrow canvases', () => {
    expect(barLayout(63, 64)).toEqual({ barWidth: 1, gap: 0, offset: 0, barCount: 63 });
    expect(barLayout(0, 64)).toEqual({ barWidth: 0, gap: 0, offset: 0, barCount: 0 });
  });

  it('caps bar width so sparse spectra stay centered instead of fat', () => {
    const layout = barLayout(104, 8);
    expect(layout.barCount).toBe(8);
    expect(layout.barWidth).toBe(4);
    expect(layout.offset).toBe(32);
  });

  it('drawBars paints a horizontally centered group', () => {
    const fb = makeFb(104, 20);
    drawBars(fb, BANDS_64, createPeakState());
    const cols = paintedColumns(fb);
    expect(cols.length).toBe(64);
    const left = cols[0]!;
    const right = fb.width - 1 - cols[cols.length - 1]!;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(left).toBe(20);
  });

  it('drawBars tracks peak height by frequency band index', () => {
    const fb = makeFb(104, 20);
    const data = Array.from({ length: 64 }, () => 0.1);
    data[32] = 1.0;
    drawBars(fb, data, createPeakState());
    const layout = barLayout(104, 64);
    const peakX = layout.offset + 32 * (layout.barWidth + layout.gap);
    const tallest = [...fb.cells.entries()]
      .filter(([key]) => Number(key.split(',')[0]) === peakX)
      .map(([, ch]): number => (ch === '█' ? 8 : 0))
      .reduce((a, b) => a + b, 0);
    expect(tallest).toBe(fb.height * 8);
    const quiet = [...fb.cells.entries()]
      .filter(([key]) => Number(key.split(',')[0]) === layout.offset)
      .filter(([, ch]) => ch === '█').length;
    expect(quiet).toBeLessThan(peakX === layout.offset ? 0 : fb.height);
  });

  it('drawBars on a full-width canvas fills every column exactly once', () => {
    const fb = makeFb(64, 12);
    drawBars(fb, BANDS_64, createPeakState());
    expect(paintedColumns(fb).length).toBe(64);
  });

  it('holds the peak cap before letting it fall and re-pins on a new high', () => {
    const fb = makeFb(8, 4);
    const state = createPeakState();
    const high = [1, 1, 1, 1];
    const low = [0.05, 0.05, 0.05, 0.05];

    drawBars(fb, high, state, 1000);
    drawBars(fb, low, state, 1001);
    // Hold period: the cap stays pinned at the top.
    expect(markerRows(fb)).toEqual([0]);
    // Still pinned just before the 500 ms hold expires.
    drawBars(fb, low, state, 1499);
    expect(markerRows(fb)).toEqual([0]);

    drawBars(fb, low, state, 2300);
    drawBars(fb, low, state, 2620);
    // After the hold the cap has started falling toward the bar.
    expect(markerRows(fb)).toEqual([1]);

    drawBars(fb, high, state, 2700);
    drawBars(fb, low, state, 2701);
    // A new high re-pins the cap for another hold period.
    expect(markerRows(fb)).toEqual([0]);
  });

  it('keeps peak state isolated between canvases', () => {
    const a = makeFb(8, 4);
    const b = makeFb(8, 4);
    const stateA = createPeakState();
    const stateB = createPeakState();
    const high = [1, 1, 1, 1];
    const low = [0.05, 0.05, 0.05, 0.05];

    // Two canvases on different clocks must not share hold/fall timers.
    drawBars(a, high, stateA, 1000);
    drawBars(b, high, stateB, 5000);
    drawBars(a, low, stateA, 1100);
    drawBars(b, low, stateB, 5100);
    expect(markerRows(a)).toEqual([0]);
    expect(markerRows(b)).toEqual([0]);

    drawBars(b, low, stateB, 6300);
    drawBars(b, low, stateB, 6620);
    expect(markerRows(b)).toEqual([1]);
    // A is still inside its own hold window at t=1200.
    drawBars(a, low, stateA, 1200);
    expect(markerRows(a)).toEqual([0]);
  });

  it('drawWave renders an oscilloscope centered on the vertical midpoint', () => {
    const fb = makeFb(40, 21);
    drawWave(fb, [0.5, 0.5, 0.5, 0.5]);
    expect(fb.cells.get('0,5')).toBe('●');
    expect(fb.cells.get('0,8')).toBe('│');
    expect(fb.cells.get('0,10')).toBe('│');
    expect(fb.cells.has('0,0')).toBe(false);
    expect(fb.cells.get('0,10')).not.toBeUndefined();
  });

  it('drawWave clears to background when there is no data', () => {
    const fb = makeFb(20, 10);
    fb.cells.set('3,3', '█');
    drawWave(fb, []);
    expect(fb.cells.size).toBe(0);
  });

  it('accepts a plain RGBA-clearing buffer without throwing', () => {
    const fb: OptimizedBufferLike = {
      width: 10,
      height: 4,
      clear: (bg: RGBA) => {
        expect(bg).toBeInstanceOf(RGBA);
      },
      setCell: () => {},
    };
    expect(() => drawBars(fb, BANDS_64, createPeakState())).not.toThrow();
    expect(() => drawWave(fb, [0, 0.5, -0.5])).not.toThrow();
  });
});
