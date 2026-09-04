import {
  BoxRenderable,
  type CliRenderer,
  FrameBufferRenderable,
  SelectRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from '@opentui/core';
import { COLOR_ACCENT, COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
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
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title,
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
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  // Fullscreen visualizer owns the only pixels. The frame buffer has a
  // fixed size: @opentui/core 0.5.10 exposes no public fb-resize API, so
  // per-resize pixel sizing is blocked upstream; drawing adapts to these
  // dimensions and narrow terminals reduce bar density instead.
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
  visualizerFull.add(visualizerFullFb);

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
  };
}
