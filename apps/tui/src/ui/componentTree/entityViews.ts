import {
  BoxRenderable,
  type CliRenderer,
  FrameBufferRenderable,
  ImageRenderable,
  SelectRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from '@opentui/core';
import {
  COLOR_ACCENT,
  COLOR_BORDER,
  COLOR_BORDER_FOCUS,
  COLOR_DIM,
  COLOR_PANEL_BG,
  COLOR_TEXT,
} from '../theme';
import { resolveImageProtocol } from '../imageProtocol';
import type { UiViewState } from '../types';

export interface EntityViewNodes {
  artist: BoxRenderable;
  artistList: SelectRenderable;
  album: BoxRenderable;
  albumList: SelectRenderable;
  playlist: BoxRenderable;
  playlistList: SelectRenderable;
  browse: BoxRenderable;
  browseList: SelectRenderable;
  visualizerFull: BoxRenderable;
  visualizerFullTitle: TextRenderable;
  visualizerFullFb: FrameBufferRenderable;
  visualizerCoverImage: ImageRenderable;
}

function makeListView(
  renderer: CliRenderer,
  id: string,
  title: string,
): { box: BoxRenderable; list: SelectRenderable } {
  const box = new BoxRenderable(renderer, {
    id,
    width: '100%',
    flexGrow: 1,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ` ${title} `,
    titleColor: COLOR_TEXT,
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const list = new SelectRenderable(renderer, {
    id: `${id}-list`,
    options: [{ name: '(loading…)', description: 'Fetching from Spotify' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  box.add(list);
  return { box, list };
}

export function buildEntityViews(renderer: CliRenderer, state: UiViewState): EntityViewNodes {
  const artist = makeListView(renderer, 'view-artist', 'Artist (Enter: play, x: actions)');
  const album = makeListView(renderer, 'view-album', 'Album (Enter: play, x: actions)');
  const playlist = makeListView(renderer, 'view-playlist', 'Playlist (Enter: play, x: actions)');
  const browse = makeListView(renderer, 'view-browse', 'Browse (Enter: open, Esc: back)');

  const visualizerFull = new BoxRenderable(renderer, {
    id: 'view-visualizer',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Visualizer (V: close, m: mode)',
    flexDirection: 'column',
    alignItems: 'center',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  // Fullscreen visualizer owns the only pixels. The frame buffer fills the
  // whole panel: its Yoga size change flows through
  // Renderable.onLayoutResize -> FrameBufferRenderable.onResize, which
  // resizes the backing OptimizedBuffer automatically. Drawing centers the
  // bar group itself, so the canvas can stay full-bleed.
  const visualizerFullTitle = new TextRenderable(renderer, {
    id: 'visualizer-full-title',
    content: t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`,
  });
  visualizerFull.add(visualizerFullTitle);
  const visualizerFullFb = new FrameBufferRenderable(renderer, {
    id: 'visualizer-full-fb',
    width: 104,
    height: 20,
  });
  visualizerFullFb.width = '100%';
  visualizerFullFb.height = 'auto';
  visualizerFullFb.flexGrow = 1;
  visualizerFullFb.flexShrink = 1;
  visualizerFull.add(visualizerFullFb);

  // Cover art sits on top of the frame buffer at the center of the circular
  // spectrum. Absolute positioning lets it float without changing the canvas
  // layout that every other mode depends on.
  const visualizerCoverImage = new ImageRenderable(renderer, {
    id: 'visualizer-cover-image',
    position: 'absolute',
    top: 1,
    left: 0,
    width: 12,
    height: 6,
    fit: 'cover',
    protocol: resolveImageProtocol(),
    visible: false,
    zIndex: 5,
  });
  visualizerFull.add(visualizerCoverImage);

  return {
    artist: artist.box,
    artistList: artist.list,
    album: album.box,
    albumList: album.list,
    playlist: playlist.box,
    playlistList: playlist.list,
    browse: browse.box,
    browseList: browse.list,
    visualizerFull,
    visualizerFullTitle,
    visualizerFullFb,
    visualizerCoverImage,
  };
}
