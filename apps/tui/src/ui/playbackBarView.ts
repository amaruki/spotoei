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
}

// Three tiers per spec §15: >=120 full, 80–119 compact (no album,
// short hints), <80 minimal. Width must come from the renderer, not
// process.stdout, so tests and remotes render the right tier.
export const WIDE_BREAKPOINT = 120;
export const NARROW_BREAKPOINT = 80;

function renderFullProgressBar(pos: string, dur: string, pct: number, width: number): string {
  const availableWidth = Math.max(20, width - 4);
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

  if (input.width < NARROW_BREAKPOINT) {
    const title = truncate(rawTitle, Math.max(10, input.width - 25));
    const artist = truncate(rawArtist, Math.max(8, input.width - 30));
    return {
      variant: 'narrow',
      line1: `${icon} ${title} — ${artist}  ${pos} / ${dur}`,
      line2: 'Space Pause · n Next · V Visualizer · ?: palette',
    };
  }

  const pct = input.durationMs > 0 ? Math.min(1, Math.max(0, input.positionMs / input.durationMs)) : 0;
  const progressBar = renderFullProgressBar(pos, dur, pct, input.width);

  if (input.width < WIDE_BREAKPOINT) {
    const title = truncate(rawTitle, Math.max(12, Math.floor(input.width * 0.35)));
    const artist = truncate(rawArtist, Math.max(8, Math.floor(input.width * 0.22)));
    const badges = `Shuf ${input.shuffle ? 'on' : 'off'}  Rep ${input.repeat}  Q:${input.queueCount}`;
    const left = `${icon} ${title} — ${artist}`;
    const availableWidth = Math.max(20, input.width - 4);
    const spacePadding = Math.max(2, availableWidth - left.length - badges.length);
    const line1 = `${left}${' '.repeat(spacePadding)}${badges}`;
    return {
      variant: 'medium',
      line1,
      line2: progressBar,
    };
  }

  const title = truncate(rawTitle, Math.max(15, Math.floor(input.width * 0.32)));
  const artist = truncate(rawArtist, Math.max(10, Math.floor(input.width * 0.20)));
  const albumStr = input.album ? ` • ${truncate(input.album, Math.max(10, Math.floor(input.width * 0.18)))}` : '';
  const badges = `Shuffle ${input.shuffle ? 'on' : 'off'}  Repeat ${input.repeat}  Queue: ${input.queueCount}  Vol: ${input.volume}%`;
  const left = `${icon} ${title} — ${artist}${albumStr}`;
  const availableWidth = Math.max(20, input.width - 4);
  const spacePadding = Math.max(2, availableWidth - left.length - badges.length);
  const line1 = `${left}${' '.repeat(spacePadding)}${badges}`;

  return {
    variant: 'wide',
    line1,
    line2: progressBar,
  };
}
