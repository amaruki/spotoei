import { BoxRenderable, type CliRenderer, TextRenderable, fg, t } from '@opentui/core';
import { COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';

export interface PlaybackBarNodes {
  playbackBar: BoxRenderable;
  playbackTrackText: TextRenderable;
  playbackProgressText: TextRenderable;
  statusText: TextRenderable;
}

export function buildPlaybackBar(renderer: CliRenderer): PlaybackBarNodes {
  const playbackBar = new BoxRenderable(renderer, {
    id: 'playback-bar',
    height: 5,
    flexDirection: 'column',
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Now Playing ',
    titleColor: COLOR_TEXT,
    bottomTitle: ' [Space] Play/Pause  [n] Next  [p] Prev  [?] Help ',
    bottomTitleAlignment: 'right',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const playbackTrackText = new TextRenderable(renderer, {
    id: 'playback-track-text',
    content: t`${fg(COLOR_DIM)('■ No track playing')}`,
  });
  const playbackProgressText = new TextRenderable(renderer, {
    id: 'playback-progress-text',
    content: t`${fg(COLOR_DIM)('0:00  ────────────────────────────────────────────────────────────  0:00 (0%)')}`,
  });
  const statusText = new TextRenderable(renderer, {
    id: 'status',
    content: t`${fg(COLOR_DIM)('Space: play/pause  n: next  p: prev  V: viz  l: lyrics  S: shuffle  R: repeat  A: autoplay  /: search  r: library  u: queue  q: quit')}`,
  });
  playbackBar.add(playbackTrackText);
  playbackBar.add(playbackProgressText);
  playbackBar.add(statusText);
  return { playbackBar, playbackTrackText, playbackProgressText, statusText };
}
