import { bold, fg, t } from '@opentui/core';
import { formatArtists } from '../formatters';
import { COLOR_TEXT } from '../theme';
import type { UiViewState } from '../types';

export function getHomeContent(state: UiViewState) {
  const track = state.playback?.track;
  const artist = formatArtists(track?.artists as Array<string | { name: string }> | undefined);
  const album = track?.album ?? (track as { albumName?: string } | undefined)?.albumName ?? '—';
  const posSec = Math.floor((state.playback?.positionMs ?? 0) / 1000);
  const durSec = Math.floor((state.playback?.durationMs ?? 0) / 1000);
  const volPercent = Math.round((state.playback?.volume ?? 1) * 100);
  return t`${bold('Overview')}
${fg(COLOR_TEXT)(`Protocol: ${state.protocol}`)}
${fg(COLOR_TEXT)(`Player: ${state.playerVersion}`)}
${fg(COLOR_TEXT)(`Capabilities: ${state.capabilities.join(', ') || '(none)'}`)}

${fg(COLOR_TEXT)(`Track: ${typeof track?.name === 'string' ? track.name : '(idle)'}`)}
${fg(COLOR_TEXT)(`Artist: ${artist}`)}
${fg(COLOR_TEXT)(`Album: ${album}`)}
${fg(COLOR_TEXT)(`State: ${state.playback?.state ?? 'idle'}`)}
${fg(COLOR_TEXT)(`Position: ${posSec}s / ${durSec}s`)}
${fg(COLOR_TEXT)(`Volume: ${volPercent}%`)}
${fg(COLOR_TEXT)(`Shuffle: ${state.playback?.shuffle ? 'on' : 'off'}`)}
${fg(COLOR_TEXT)(`Repeat: ${state.playback?.repeat ?? 'off'}`)}
${fg(COLOR_TEXT)(`Autoplay: ${state.playback?.autoplay ? 'on' : 'off'}`)}`;
}
