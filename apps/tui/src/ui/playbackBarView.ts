// Responsive playback bar content builder (spec §15).
// Wide keeps album + full controls; narrow keeps state, title, progress only.
// Genre is never rendered; status messages stay outside this builder.

import { formatTime } from './formatters';

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

export interface PlaybackBarInput {
  state: 'playing' | 'paused' | 'idle';
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  hasCoverArt?: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: string;
  queueCount: number;
  volume: number;
  width: number;
}

export interface PlaybackBarContent {
  variant: 'wide' | 'medium' | 'narrow';
  line1: string;
  line2: string;
  line3: string;
  hasCoverArt: boolean;
}
// short hints), <80 minimal. Width must come from the renderer, not
// process.stdout, so tests and remotes render the right tier.
export const WIDE_BREAKPOINT = 120;
export const NARROW_BREAKPOINT = 80;

function renderFullProgressBar(pos: string, dur: string, pct: number, availableWidth: number): string {
  const timePrefix = `${pos} `;
  const pctStr = `${Math.round(pct * 100)}%`;
  const timeSuffix = ` ${dur} (${pctStr})`;
  const barLen = Math.max(8, availableWidth - timePrefix.length - timeSuffix.length);
  const filled = Math.min(barLen, Math.max(0, Math.round(pct * barLen)));
  const bar = '━'.repeat(filled) + '─'.repeat(barLen - filled);
  return `${timePrefix}${bar}${timeSuffix}`;
}

export function buildPlaybackBarContent(input: PlaybackBarInput): PlaybackBarContent {
  const icon = input.state === 'playing' ? '▶' : input.state === 'paused' ? '⏸' : '■';
  const pos = formatTime(input.positionMs);
  const dur = formatTime(input.durationMs);
  const rawTitle = input.title || '(no track)';
  const rawArtist = input.artist || '—';
  const hasCover = Boolean(input.hasCoverArt && input.state !== 'idle');

  // Cover art 3-row box prefix (6 columns + 1 space = 7 columns)
  const artPrefix1 = hasCover ? '╭────╮ ' : '';
  const artPrefix2 = hasCover ? '│ 💽 │ ' : '';
  const artPrefix3 = hasCover ? '╰────╯ ' : '';
  const artColWidth = hasCover ? 7 : 0;

  // Available inner content width (width minus 4 for borders/padding, minus cover art width)
  const innerWidth = Math.max(20, input.width - 4 - artColWidth);

  if (input.width < NARROW_BREAKPOINT) {
    const title = truncate(rawTitle, Math.max(10, innerWidth - 25));
    const artist = truncate(rawArtist, Math.max(8, innerWidth - 30));
    return {
      variant: 'narrow',
      line1: `${artPrefix1}${icon} ${title}`,
      line2: `${artPrefix2}${pos} / ${dur}`,
      line3: `${artPrefix3}${artist}`,
      hasCoverArt: hasCover,
    };
  }

  const pct = input.durationMs > 0 ? Math.min(1, Math.max(0, input.positionMs / input.durationMs)) : 0;
  const progressBar = renderFullProgressBar(pos, dur, pct, innerWidth);

  // Badges: shuffle, repeat, volume
  const shuf = input.shuffle ? 'on' : 'off';
  const vol = `${input.volume}%`;
  const badges = input.width < WIDE_BREAKPOINT
    ? `Shuf: ${shuf}  Rep: ${input.repeat}  Vol: ${vol}`
    : `🔀 Shuf: ${shuf}   🔁 Rep: ${input.repeat}   🔉 ${vol}`;

  // Row 1: Title (left) & Badges (right)
  const titleCap = Math.max(10, innerWidth - badges.length - 4);
  const title = truncate(rawTitle, titleCap);
  const left1 = `${icon} ${title}`;
  const pad1 = Math.max(2, innerWidth - left1.length - badges.length);
  const line1 = `${artPrefix1}${left1}${' '.repeat(pad1)}${badges}`;

  // Row 2: Full-width progress bar
  const line2 = `${artPrefix2}${progressBar}`;

  // Row 3: Artist • Album • Genre
  const albumPart = input.album ? `  •  Album: ${input.album}` : '';
  const genrePart = input.genre ? `  •  Genre: ${input.genre}` : '';
  const rawMeta = `${rawArtist}${albumPart}${genrePart}`;
  const line3 = `${artPrefix3}${truncate(rawMeta, innerWidth)}`;

  return {
    variant: input.width < WIDE_BREAKPOINT ? 'medium' : 'wide',
    line1,
    line2,
    line3,
    hasCoverArt: hasCover,
  };
}
