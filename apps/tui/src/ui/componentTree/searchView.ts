import { BoxRenderable, type CliRenderer } from '@opentui/core';
import { makeGridColumn, makeListPanel, type PanelNodes } from './panels';

export interface SearchGridNodes {
  searchRow: BoxRenderable;
  searchTracks: BoxRenderable;
  searchTracksList: PanelNodes['list'];
  searchArtists: BoxRenderable;
  searchArtistsList: PanelNodes['list'];
  searchAlbums: BoxRenderable;
  searchAlbumsList: PanelNodes['list'];
  searchPlaylists: BoxRenderable;
  searchPlaylistsList: PanelNodes['list'];
}

const emptyTracks = [{ name: '(no results)', description: 'Type a query above and press Enter' }];
const emptyOther = [{ name: '(no results)', description: '' }];

// Search 2x2 grid: Tracks | Artists on the first row, Albums |
// Playlists on the second. Narrow terminals stack vertically.
export function buildSearchGrid(renderer: CliRenderer): SearchGridNodes {
  const searchRow = new BoxRenderable(renderer, {
    id: 'search-row',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
  });
  const colLeft = makeGridColumn(renderer, 'search-col-left');
  const colRight = makeGridColumn(renderer, 'search-col-right');
  const tracks = makeListPanel(renderer, 'search-tracks', 'Tracks', emptyTracks);
  const albums = makeListPanel(renderer, 'search-albums', 'Albums', emptyOther);
  const artists = makeListPanel(renderer, 'search-artists', 'Artists', emptyOther);
  const playlists = makeListPanel(renderer, 'search-playlists', 'Playlists', emptyOther);
  colLeft.add(tracks.box);
  colLeft.add(albums.box);
  colRight.add(artists.box);
  colRight.add(playlists.box);
  searchRow.add(colLeft);
  searchRow.add(colRight);
  return {
    searchRow,
    searchTracks: tracks.box,
    searchTracksList: tracks.list,
    searchArtists: artists.box,
    searchArtistsList: artists.list,
    searchAlbums: albums.box,
    searchAlbumsList: albums.list,
    searchPlaylists: playlists.box,
    searchPlaylistsList: playlists.list,
  };
}
