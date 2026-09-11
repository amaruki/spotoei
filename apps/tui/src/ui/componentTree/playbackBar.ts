import {
  BoxRenderable,
  type CliRenderer,
  ImageRenderable,
  TextRenderable,
  fg,
  t,
} from '@opentui/core';
import { COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import { resolveImageProtocol } from '../imageProtocol';

export interface PlaybackBarNodes {
  playbackBar: BoxRenderable;
  playbackCoverBox: BoxRenderable;
  playbackCoverImage: ImageRenderable;
  playbackTrackText: TextRenderable;
  playbackProgressText: TextRenderable;
  statusText: TextRenderable;
}

export function buildPlaybackBar(renderer: CliRenderer): PlaybackBarNodes {
  const playbackBar = new BoxRenderable(renderer, {
    id: 'playback-bar',
    height: 5,
    flexDirection: 'row',
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Now Playing ',
    titleColor: COLOR_TEXT,
    paddingLeft: 1,
    paddingRight: 1,
  });

  const playbackCoverBox = new BoxRenderable(renderer, {
    id: 'playback-cover-box',
    width: 8,
    height: 3,
    backgroundColor: COLOR_PANEL_BG,
    marginRight: 1,
    visible: false,
  });

  // Full inner height of the bar: a 6x1 crop is unrecognizable, especially
  // on terminals that fall back to the block protocol.
  const playbackCoverImage = new ImageRenderable(renderer, {
    id: 'playback-cover-image',
    width: 8,
    height: 3,
    fit: 'cover',
    protocol: resolveImageProtocol(),
  });
  playbackCoverBox.add(playbackCoverImage);

  const playbackContentBox = new BoxRenderable(renderer, {
    id: 'playback-content-box',
    height: 3,
    flexGrow: 1,
    flexDirection: 'column',
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
    content: t`${fg(COLOR_DIM)('Select a song to start listening')}`,
  });

  playbackContentBox.add(playbackTrackText);
  playbackContentBox.add(playbackProgressText);
  playbackContentBox.add(statusText);

  playbackBar.add(playbackCoverBox);
  playbackBar.add(playbackContentBox);

  return {
    playbackBar,
    playbackCoverBox,
    playbackCoverImage,
    playbackTrackText,
    playbackProgressText,
    statusText,
  };
}
