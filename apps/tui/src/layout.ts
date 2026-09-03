import { displayWidth } from './text';

export type LayoutTier = 'wide' | 'medium' | 'narrow';

export function getLayoutTier(columns: number): LayoutTier {
  if (columns >= 120) return 'wide';
  if (columns >= 80) return 'medium';
  return 'narrow';
}

export interface BoxOptions {
  width?: number;
  height?: number;
  title?: string;
  focused?: boolean;
}

function displaySlice(s: string, maxWidth: number): string {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
  }
  return out;
}

function displayPad(s: string, targetWidth: number): string {
  const w = displayWidth(s);
  return w >= targetWidth ? s : s + ' '.repeat(targetWidth - w);
}

export function drawBox(lines: string[], opts: BoxOptions): string[] {
  const width = Math.max(10, opts.width ?? 40);
  const innerWidth = width - 2;

  const horizontalChar = opts.focused ? '═' : '─';
  const verticalChar = opts.focused ? '║' : '│';
  const topLeft = opts.focused ? '╔' : '┌';
  const topRight = opts.focused ? '╗' : '┐';
  const bottomLeft = opts.focused ? '╚' : '└';
  const bottomRight = opts.focused ? '╝' : '┘';

  let topBorder: string;
  if (opts.title) {
    const maxTitle = Math.max(0, innerWidth - 2);
    const titleFull = ` ${opts.title} `;
    const titleText =
      displayWidth(titleFull) > maxTitle ? displaySlice(titleFull, maxTitle) : titleFull;
    const titleWidth = displayWidth(titleText);
    const remaining = Math.max(0, innerWidth - titleWidth);
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    topBorder = `${topLeft}${horizontalChar.repeat(leftPad)}${titleText}${horizontalChar.repeat(rightPad)}${topRight}`;
  } else {
    topBorder = `${topLeft}${horizontalChar.repeat(innerWidth)}${topRight}`;
  }

  const bottomBorder = `${bottomLeft}${horizontalChar.repeat(innerWidth)}${bottomRight}`;

  const content: string[] = [topBorder];
  const maxLines = opts.height ? Math.max(1, opts.height - 2) : lines.length;

  for (let i = 0; i < maxLines; i++) {
    const raw = lines[i] ?? '';
    const truncated = displayWidth(raw) > innerWidth ? displaySlice(raw, innerWidth) : raw;
    content.push(`${verticalChar}${displayPad(truncated, innerWidth)}${verticalChar}`);
  }

  content.push(bottomBorder);
  return content;
}

export function renderStatusBar(opts: {
  width: number;
  route: string;
  playbackState?: string;
  trackName?: string;
  hint?: string;
}): string {
  const width = Math.max(10, opts.width | 0);
  const left = ` [${opts.route.toUpperCase()}] ${opts.playbackState ?? 'IDLE'}${opts.trackName ? ` - ${opts.trackName}` : ''}`;
  const right = `${opts.hint ?? '?: help | Space: play | q: quit'} `;

  const leftW = displayWidth(left);
  const rightW = displayWidth(right);

  if (leftW + rightW >= width) {
    const keepRight = displaySlice(right, Math.max(0, width - 1));
    const keepRightW = displayWidth(keepRight);
    const leftSpace = Math.max(0, width - keepRightW);
    return displaySlice(left, leftSpace) + keepRight;
  }
  const availableSpace = width - leftW - rightW;
  return left + ' '.repeat(availableSpace) + right;
}
