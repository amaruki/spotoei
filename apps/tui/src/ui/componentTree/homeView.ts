import { BoxRenderable, type CliRenderer, TextRenderable, fg, t } from '@opentui/core';
import { COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG } from '../theme';
import { homeRowOptions } from '../views/homeRows';
import { makeGridColumn, makeListPanel, type PanelNodes } from './panels';

export interface HomeViewNodes {
  homeRow: BoxRenderable;
  homeTracks: BoxRenderable;
  homeTracksList: PanelNodes['list'];
  homeArtists: BoxRenderable;
  homeArtistsList: PanelNodes['list'];
  homeRecent: BoxRenderable;
  homeRecentList: PanelNodes['list'];
  homeNow: BoxRenderable;
  homeNowText: TextRenderable;
}

// Home 2x2 grid: Top Tracks | Top Artists on the first row, Recently
// Played | Now Playing on the second. Narrow terminals stack vertically.
export function buildHomeView(renderer: CliRenderer): HomeViewNodes {
  const homeRow = new BoxRenderable(renderer, {
    id: 'home-row',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
  });
  const colLeft = makeGridColumn(renderer, 'home-col-left');
  const colRight = makeGridColumn(renderer, 'home-col-right');
  const tracks = makeListPanel(renderer, 'home-tracks', 'Top Tracks', homeRowOptions([]));
  const recent = makeListPanel(renderer, 'home-recent', 'Recently Played', homeRowOptions([]));
  const artists = makeListPanel(renderer, 'home-artists', 'Top Artists', homeRowOptions([]));
  const homeNow = new BoxRenderable(renderer, {
    id: 'home-now',
    flexGrow: 1,
    flexShrink: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Now Playing',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const homeNowText = new TextRenderable(renderer, {
    id: 'home-now-text',
    content: t`${fg(COLOR_DIM)('Nothing playing')}`,
  });
  homeNow.add(homeNowText);
  colLeft.add(tracks.box);
  colLeft.add(recent.box);
  colRight.add(artists.box);
  colRight.add(homeNow);
  homeRow.add(colLeft);
  homeRow.add(colRight);
  return {
    homeRow,
    homeTracks: tracks.box,
    homeTracksList: tracks.list,
    homeArtists: artists.box,
    homeArtistsList: artists.list,
    homeRecent: recent.box,
    homeRecentList: recent.list,
    homeNow,
    homeNowText,
  };
}
