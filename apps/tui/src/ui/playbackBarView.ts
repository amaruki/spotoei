// Responsive playback bar content builder (spec §15).
// Wide keeps album + full controls; narrow keeps state, title, progress only.
// Genre is never rendered; status messages stay outside this builder.

import { formatTime } from './formatters';

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

export function buildPlaybackBarContent(input: PlaybackBarInput): PlaybackBarContent {
  const icon = input.state === 'playing' ? '▶' : input.state === 'paused' ? '⏸' : '■';
  const pos = formatTime(input.positionMs);
  const dur = formatTime(input.durationMs);
  const title = input.title || '(no track)';
  const artist = input.artist || '—';
  if (input.width < NARROW_BREAKPOINT) {
    return {
      variant: 'narrow',
      line1: `${icon} ${title} — ${artist}  ${pos} / ${dur}`,
      line2: 'Space Pause · n Next · V Visualizer',
    };
  }
  if (input.width < WIDE_BREAKPOINT) {
    return {
      variant: 'medium',
      line1: `${icon} ${title} — ${artist}  ${pos} ━━━━━━━━ ${dur}`,
      line2: `Shuf ${input.shuffle ? 'on' : 'off'} Rep ${input.repeat} Q:${input.queueCount} · Space Pause · n Next`,
    };
  }
  const album = input.album ? `\n    Album ${input.album}` : '';
  return {
    variant: 'wide',
    line1: `${icon} ${title} — ${artist}  Shuffle ${input.shuffle ? 'on' : 'off'} Repeat ${input.repeat} Queue: ${input.queueCount}${album}`,
    line2: `    ${pos} ━━━━━━━━──── ${dur}  Space Pause · n Next · p Previous · +/- Volume ${input.volume}%`,
  };
}
