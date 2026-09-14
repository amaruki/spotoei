// Renders a captured OpenTUI frame (from `createTestRenderer().captureSpans()`)
// into a standalone SVG preview. Used by `scripts/preview.ts`.
import { TextAttributes, type CapturedFrame, type CapturedSpan } from '@opentui/core';

import { COLOR_BG, COLOR_BORDER, COLOR_PANEL_BG, COLOR_TEXT } from '../src/ui/theme';

const CELL_W = 9;
const CELL_H = 19;
const FONT_SIZE = 15;
const PAD = 18;
const BAR_H = 32;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";

function colorOf(c: CapturedSpan['fg'], fallback: string): string {
  if (c.intent === 'default') return fallback;
  const [r, g, b] = c.toInts();
  return `rgb(${r},${g},${b})`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spanSvg(span: CapturedSpan, x: number, y: number): string {
  const attrs = span.attributes ?? 0;
  const inverse = (attrs & TextAttributes.INVERSE) !== 0;
  let fg = colorOf(span.fg, COLOR_TEXT);
  let bg: string | null = span.bg.intent === 'default' ? null : colorOf(span.bg, COLOR_PANEL_BG);
  if (inverse) {
    const previous = fg;
    fg = bg ?? COLOR_TEXT;
    bg = previous;
  }

  const parts: string[] = [];
  if (bg) {
    parts.push(
      `<rect x="${x}" y="${y}" width="${span.width * CELL_W}" height="${CELL_H}" fill="${bg}"/>`,
    );
  }
  if (span.text.trim().length === 0) return parts.join('');

  const bold = attrs & TextAttributes.BOLD ? ' font-weight="700"' : '';
  const italic = attrs & TextAttributes.ITALIC ? ' font-style="italic"' : '';
  const underline = attrs & TextAttributes.UNDERLINE ? ' text-decoration="underline"' : '';
  const dim = attrs & TextAttributes.DIM ? ' opacity="0.7"' : '';
  parts.push(
    `<text x="${x}" y="${y + CELL_H * 0.76}" fill="${fg}"${bold}${italic}${underline}${dim}` +
      ` font-size="${FONT_SIZE}" textLength="${span.width * CELL_W}" lengthAdjust="spacingAndGlyphs"` +
      ` xml:space="preserve">${esc(span.text)}</text>`,
  );
  return parts.join('');
}

export function frameToSvg(frame: CapturedFrame, title: string): string {
  const width = frame.cols * CELL_W + PAD * 2;
  const height = frame.rows * CELL_H + PAD * 2 + BAR_H;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`,
    `<rect width="${width}" height="${height}" rx="12" fill="${COLOR_BG}"/>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="${COLOR_BORDER}"/>`,
  ];

  ['#f85149', '#d29922', '#3fb950'].forEach((color, i) => {
    out.push(
      `<circle cx="${PAD + i * 20}" cy="${PAD / 2 + BAR_H / 2 - 1}" r="5.5" fill="${color}"/>`,
    );
  });
  out.push(
    `<text x="${width / 2}" y="${PAD / 2 + BAR_H / 2 + 3}" fill="#8b949e" font-family="${MONO}" font-size="13" text-anchor="middle">${esc(title)}</text>`,
  );
  out.push(`<g font-family="${MONO}">`);

  const ox = PAD;
  const oy = PAD + BAR_H;
  frame.lines.forEach((line, row) => {
    let col = 0;
    for (const span of line.spans) {
      if (span.width > 0) out.push(spanSvg(span, ox + col * CELL_W, oy + row * CELL_H));
      col += span.width;
    }
  });

  out.push('</g>', '</svg>');
  return out.join('\n') + '\n';
}
