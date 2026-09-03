import { BoxRenderable, type CliRenderer, SelectRenderable, TextRenderable } from '@opentui/core';
import { COLOR_BORDER, COLOR_PANEL_BG } from '../theme';

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
  visualizerFullText: TextRenderable;
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

export function buildEntityViews(renderer: CliRenderer): EntityViewNodes {
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
  const visualizerFullText = new TextRenderable(renderer, {
    id: 'visualizer-full-text',
    content: '(visualizer fullscreen — press V to exit, m to cycle mode)',
  });
  visualizerFull.add(visualizerFullText);

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
    visualizerFullText,
  };
}
