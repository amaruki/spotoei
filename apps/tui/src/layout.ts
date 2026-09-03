// Terminal layout helpers and responsive breakpoint classification.
//
// Wide (>=120): Sidebar + Main Content + Context Panel
// Medium (80-119): Sidebar + Main Content (Context as overlay/modal)
// Narrow (<80): Single primary panel at a time

export type LayoutTier = 'wide' | 'medium' | 'narrow';

export function getLayoutTier(columns: number): LayoutTier {
  if (columns >= 120) return 'wide';
  if (columns >= 80) return 'medium';
  return 'narrow';
}

export interface BoxOptions {
  width: number;
  height?: number;
  title?: string;
  focused?: boolean;
}

export function drawBox(lines: string[], opts: BoxOptions): string[] {
  const width = Math.max(10, opts.width);
  const innerWidth = width - 2;
  const horizontalChar = opts.focused ? '═' : '─';
  const topLeft = opts.focused ? '╔' : '┌';
  const topRight = opts.focused ? '╗' : '┐';
  const bottomLeft = opts.focused ? '╚' : '└';
  const bottomRight = opts.focused ? '╝' : '┘';
  const verticalChar = opts.focused ? '║' : '│';

  let topBorder: string;
  if (opts.title) {
    // Truncate title if it would exceed inner width; reserve at least 2 chars
    // for the side padding to keep the corners readable.
    const maxTitle = Math.max(0, innerWidth - 2);
    const titleText = ` ${opts.title.length > maxTitle ? opts.title.slice(0, maxTitle) : opts.title} `;
    const remaining = Math.max(0, innerWidth - titleText.length);
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
    const truncated = raw.length > innerWidth ? raw.slice(0, innerWidth) : raw;
    content.push(`${verticalChar}${truncated.padEnd(innerWidth, ' ')}${verticalChar}`);
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

  // Assemble: left + padding + right, clamped to exactly `width` chars.
  if (left.length + right.length >= width) {
    // Both can't fit — keep right, truncate left.
    const keepRight = right.slice(Math.max(0, right.length - (width - 1)));
    const leftSpace = Math.max(0, width - keepRight.length);
    return left.slice(0, leftSpace) + keepRight;
  }
  const availableSpace = width - left.length - right.length;
  return left + ' '.repeat(availableSpace) + right;
}
