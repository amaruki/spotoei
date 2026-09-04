import { BoxRenderable, type CliRenderer } from '@opentui/core';
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
  homeDiscover: BoxRenderable;
  homeDiscoverList: PanelNodes['list'];
}

// Home 2x2 grid: Top Tracks | Top Artists on the first row, Recently
// Played | Discover on the second. Narrow terminals stack vertically.
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
  const discover = makeListPanel(renderer, 'home-discover', 'Discover', homeRowOptions([]));
  colLeft.add(tracks.box);
  colLeft.add(recent.box);
  colRight.add(artists.box);
  colRight.add(discover.box);
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
    homeDiscover: discover.box,
    homeDiscoverList: discover.list,
  };
}
