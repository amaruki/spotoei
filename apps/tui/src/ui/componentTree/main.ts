import {
  ASCIIFontRenderable,
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from '@opentui/core';
import { COLOR_BG, COLOR_BORDER, COLOR_BORDER_FOCUS, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import type { UiViewState } from '../types';
import { getSettingsContent } from '../views/settings';
import { buildEntityViews, type EntityViewNodes } from './entityViews';
import { buildHomeView } from './homeView';
import { buildLyricsView } from './lyricsView';
import { buildOnboardingView } from './onboardingView';
import { buildSearchGrid } from './searchView';

export interface MainNodes extends EntityViewNodes {
  center: BoxRenderable;
  main: BoxRenderable;
  home: BoxRenderable;
  homeRow: BoxRenderable;
  homeTracks: BoxRenderable;
  homeTracksList: SelectRenderable;
  homeArtists: BoxRenderable;
  homeArtistsList: SelectRenderable;
  homeRecent: BoxRenderable;
  homeRecentList: SelectRenderable;
  homeDiscover: BoxRenderable;
  homeDiscoverList: SelectRenderable;
  search: BoxRenderable;
  searchInputBox: BoxRenderable;
  searchInput: InputRenderable;
  searchResultsBox: BoxRenderable;
  searchRow: BoxRenderable;
  searchTracks: BoxRenderable;
  searchTracksList: SelectRenderable;
  searchArtists: BoxRenderable;
  searchArtistsList: SelectRenderable;
  searchAlbums: BoxRenderable;
  searchAlbumsList: SelectRenderable;
  searchPlaylists: BoxRenderable;
  searchPlaylistsList: SelectRenderable;
  library: BoxRenderable;
  libraryList: SelectRenderable;
  queue: BoxRenderable;
  queueList: SelectRenderable;
  lyrics: BoxRenderable;
  lyricsScroll: ScrollBoxRenderable;
  lyricsText: TextRenderable;
  lyricsResumeHint: TextRenderable;
  settings: BoxRenderable;
  settingsText: TextRenderable;
  onboarding: BoxRenderable;
  onboardingHero: ASCIIFontRenderable;
  onboardingHeroSmall: ASCIIFontRenderable;
  onboardingText: TextRenderable;
  clientIdBox: BoxRenderable;
  clientIdInput: InputRenderable;
}

export function buildMain(renderer: CliRenderer, state: UiViewState): MainNodes {
  const center = new BoxRenderable(renderer, {
    id: 'center',
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  });

  const main = new BoxRenderable(renderer, {
    id: 'main',
    flexGrow: 1,
    border: false,
    backgroundColor: COLOR_BG,
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
  });
  center.add(main);

  // Home view
  const home = new BoxRenderable(renderer, {
    id: 'view-home',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
  });
  const homeView = buildHomeView(renderer);
  home.add(homeView.homeRow);
  main.add(home);

  // Search view
  const search = new BoxRenderable(renderer, {
    id: 'view-search',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const searchInputBox = new BoxRenderable(renderer, {
    id: 'search-input-box',
    width: '100%',
    height: 3,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Search Spotify (Type query & press Enter) ',
    titleColor: COLOR_BORDER_FOCUS,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const searchInput = new InputRenderable(renderer, {
    id: 'search-input',
    placeholder: 'Type search query and press Enter (no live search)…',
    width: '100%',
    backgroundColor: '#181818',
    focusedBackgroundColor: '#242424',
    textColor: '#FFFFFF',
    focusedTextColor: '#FFFFFF',
  });
  searchInputBox.add(searchInput);
  search.add(searchInputBox);

  const searchResultsBox = new BoxRenderable(renderer, {
    id: 'search-results-box',
    width: '100%',
    flexGrow: 1,
    border: false,
    backgroundColor: COLOR_BG,
    flexDirection: 'column',
  });
  const searchGrid = buildSearchGrid(renderer);
  searchResultsBox.add(searchGrid.searchRow);
  search.add(searchResultsBox);
  main.add(search);

  // Library view
  const library = new BoxRenderable(renderer, {
    id: 'view-library',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ' ♥ Library — Saved Tracks ',
    titleColor: COLOR_TEXT,
    bottomTitle: ' [Enter] Play  [x] Actions  [/] Filter  [r] Refresh ',
    bottomTitleAlignment: 'right',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const libraryList = new SelectRenderable(renderer, {
    id: 'library-list',
    options: [{ name: '(library empty)', description: 'Loading saved tracks…' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  library.add(libraryList);
  main.add(library);

  // Queue view
  const queue = new BoxRenderable(renderer, {
    id: 'view-queue',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ' ≡ Playback Queue ',
    titleColor: COLOR_TEXT,
    bottomTitle: ' [Enter] Play  [x] Actions  [Space] Play/Pause ',
    bottomTitleAlignment: 'right',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const queueList = new SelectRenderable(renderer, {
    id: 'queue-list',
    options: [{ name: '(no upcoming tracks)', description: 'Add tracks via search' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  queue.add(queueList);
  main.add(queue);

  // Lyrics view
  const lyricsView = buildLyricsView(renderer);
  main.add(lyricsView.lyrics);

  // Settings view
  const settings = new BoxRenderable(renderer, {
    id: 'view-settings',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Settings & Account ',
    titleColor: COLOR_TEXT,
    flexDirection: 'column',
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    visible: false,
  });
  const settingsText = new TextRenderable(renderer, {
    id: 'settings-text',
    content: getSettingsContent(state),
  });
  settings.add(settingsText);
  main.add(settings);

  // Onboarding flow (owns the Client ID input; Settings is account-only)
  const onboardingView = buildOnboardingView(renderer);
  main.add(onboardingView.onboarding);

  const entity = buildEntityViews(renderer, state);
  main.add(entity.artist);
  main.add(entity.album);
  main.add(entity.playlist);
  main.add(entity.browse);
  main.add(entity.visualizerFull);

  return {
    center,
    main,
    home,
    homeRow: homeView.homeRow,
    homeTracks: homeView.homeTracks,
    homeTracksList: homeView.homeTracksList,
    homeArtists: homeView.homeArtists,
    homeArtistsList: homeView.homeArtistsList,
    homeRecent: homeView.homeRecent,
    homeRecentList: homeView.homeRecentList,
    homeDiscover: homeView.homeDiscover,
    homeDiscoverList: homeView.homeDiscoverList,
    search,
    searchInputBox,
    searchInput,
    searchResultsBox,
    searchRow: searchGrid.searchRow,
    searchTracks: searchGrid.searchTracks,
    searchTracksList: searchGrid.searchTracksList,
    searchArtists: searchGrid.searchArtists,
    searchArtistsList: searchGrid.searchArtistsList,
    searchAlbums: searchGrid.searchAlbums,
    searchAlbumsList: searchGrid.searchAlbumsList,
    searchPlaylists: searchGrid.searchPlaylists,
    searchPlaylistsList: searchGrid.searchPlaylistsList,
    library,
    libraryList,
    queue,
    queueList,
    lyrics: lyricsView.lyrics,
    lyricsScroll: lyricsView.lyricsScroll,
    lyricsText: lyricsView.lyricsText,
    lyricsResumeHint: lyricsView.lyricsResumeHint,
    settings,
    settingsText,
    onboarding: onboardingView.onboarding,
    onboardingHero: onboardingView.onboardingHero,
    onboardingHeroSmall: onboardingView.onboardingHeroSmall,
    onboardingText: onboardingView.onboardingText,
    clientIdBox: onboardingView.clientIdBox,
    clientIdInput: onboardingView.clientIdInput,
    ...entity,
  };
}
