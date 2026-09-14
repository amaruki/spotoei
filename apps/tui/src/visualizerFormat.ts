// Pure spectrum formatting helpers for the visualizer client.
// Extracted from visualizer.ts to keep every module under the 300 LoC cap.

/**
 * Unicode 1/8th block characters for smooth meter rendering (U+2581 to U+2588).
 */
export const SPECTRUM_BLOCK_CHARS = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Format a single band magnitude in [0.0, 1.0] into a Unicode block character.
 * Values <= 0 render as empty space (' ').
 * Values > 0 map cleanly into one of [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'].
 */
export function formatBlockMeter(val: number): string {
  if (val <= 0 || !Number.isFinite(val)) {
    return ' ';
  }
  const clamped = Math.min(1, Math.max(0, val));
  const idx = Math.min(7, Math.floor(clamped * 8));
  return SPECTRUM_BLOCK_CHARS[idx] ?? ' ';
}

/**
 * Resample an array of frequency band magnitudes to a target width.
 */
export function resampleBands(bands: number[], targetWidth: number): number[] {
  if (bands.length === 0 || targetWidth <= 0) return [];
  if (bands.length === targetWidth) return [...bands];
  const result: number[] = [];
  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor((i / targetWidth) * bands.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / targetWidth) * bands.length));
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

/**
 * Format 64-band (or arbitrary) spectrum magnitudes into a string of Unicode block characters.
 * Suitable for rendering bar meters in TUI playback bars and status lines.
 */
export function formatSpectrumBar(bands: number[], targetWidth?: number): string {
  if (!bands || bands.length === 0) {
    return targetWidth ? ' '.repeat(targetWidth) : '';
  }
  const effectiveBands =
    targetWidth && targetWidth > 0 && targetWidth !== bands.length
      ? resampleBands(bands, targetWidth)
      : bands;
  return effectiveBands.map(formatBlockMeter).join('');
}
