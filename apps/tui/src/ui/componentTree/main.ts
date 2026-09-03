import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from '@opentui/core';
import { COLOR_BORDER, COLOR_BORDER_FOCUS, COLOR_DIM, COLOR_PANEL_BG } from '../theme';
import type { UiViewState } from '../types';
import { getHomeContent } from '../views/home';
import { getSettingsContent } from '../views/settings';
import { buildEntityViews, type EntityViewNodes } from './entityViews';
import { buildVisualizer, type VisualizerNodes } from './visualizer';

export interface MainNodes extends VisualizerNodes, EntityViewNodes {
  center: BoxRenderable;
  main: BoxRenderable;
  home: BoxRenderable;
  homeText: TextRenderable;
  search: BoxRenderable;
  searchInputBox: BoxRenderable;
  searchInput: InputRenderable;
  searchResultsBox: BoxRenderable;
  searchResults: SelectRenderable;
  library: BoxRenderable;
  libraryList: SelectRenderable;
  queue: BoxRenderable;
  queueList: SelectRenderable;
  lyrics: BoxRenderable;
  lyricsScroll: ScrollBoxRenderable;
  lyricsText: TextRenderable;
  settings: BoxRenderable;
  settingsText: TextRenderable;
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
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Now Playing',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });
  center.add(main);

  // Home view
  const home = new BoxRenderable(renderer, {
    id: 'view-home',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
  });
  const homeText = new TextRenderable(renderer, {
    id: 'home-text',
    content: getHomeContent(state),
  });
  home.add(homeText);
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
    borderStyle: 'single',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Search Spotify (Type query & press Enter)',
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
    marginTop: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Results (Press ↓ to browse, Enter to play)',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });
  const searchResults = new SelectRenderable(renderer, {
    id: 'search-results',
    options: [{ name: '(no results)', description: 'Type a query above and press Enter' }],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  searchResultsBox.add(searchResults);
  search.add(searchResultsBox);
  main.add(search);

  // Library view
  const library = new BoxRenderable(renderer, {
    id: 'view-library',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Saved Tracks (Press Enter to play, r to refresh)',
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
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Playback Queue (Press Enter to play)',
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
  const lyrics = new BoxRenderable(renderer, {
    id: 'view-lyrics',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const lyricsScroll = new ScrollBoxRenderable(renderer, {
    id: 'lyrics-scroll',
    width: '100%',
    flexGrow: 1,
  });
  const lyricsText = new TextRenderable(renderer, {
    id: 'lyrics-text',
    content: t`${fg(COLOR_DIM)('(no lyrics loaded — press L to fetch)')}`,
    wrapMode: 'word',
    width: '100%',
  });
  lyricsScroll.add(lyricsText);
  lyrics.add(lyricsScroll);
  main.add(lyrics);

  // Settings view
  const settings = new BoxRenderable(renderer, {
    id: 'view-settings',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const settingsText = new TextRenderable(renderer, {
    id: 'settings-text',
    content: getSettingsContent(state),
  });
  settings.add(settingsText);

  const clientIdBox = new BoxRenderable(renderer, {
    id: 'settings-client-id-box',
    width: '100%',
    flexDirection: 'column',
    marginTop: 1,
  });
  const clientIdLabel = new TextRenderable(renderer, {
    id: 'client-id-label',
    content: t`${bold('Configure Spotify Client ID')} ${fg(COLOR_DIM)('(press c / Enter to edit):')}`,
  });
  clientIdBox.add(clientIdLabel);
  const clientIdInput = new InputRenderable(renderer, {
    id: 'settings-client-id-input',
    placeholder: 'Paste Spotify Client ID here and press Enter…',
    width: '100%',
  });
  clientIdBox.add(clientIdInput);
  const clientIdHelp = new TextRenderable(renderer, {
    id: 'client-id-help',
    content: t`${fg(COLOR_DIM)('Press Enter to save to config.json')}`,
  });
  clientIdBox.add(clientIdHelp);
  settings.add(clientIdBox);
  main.add(settings);

  const viz = buildVisualizer(renderer, state);
  const entity = buildEntityViews(renderer);
  main.add(entity.artist);
  main.add(entity.album);
  main.add(entity.playlist);
  main.add(entity.browse);
  main.add(entity.visualizerFull);

  return {
    center,
    main,
    home,
    homeText,
    search,
    searchInputBox,
    searchInput,
    searchResultsBox,
    searchResults,
    library,
    libraryList,
    queue,
    queueList,
    lyrics,
    lyricsScroll,
    lyricsText,
    settings,
    settingsText,
    clientIdBox,
    clientIdInput,
    ...viz,
    ...entity,
  };
}
