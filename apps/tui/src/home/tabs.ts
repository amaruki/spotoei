// Home tab state with scope-isolated errors: a missing Top Items scope
// affects For You only, a missing Recently Played scope affects that tab.

import type { HomeTabT, TimeRangeT } from 'spotoei-protocol';

export interface HomeTabState {
  activeTab: HomeTabT;
  range: TimeRangeT;
  forYouError?: string;
  recentError?: string;
}

export function initialHomeTabs(): HomeTabState {
  return { activeTab: 'for_you', range: 'medium_term' };
}

export function switchHomeTab(state: HomeTabState, tab: HomeTabT): HomeTabState {
  return { ...state, activeTab: tab };
}

export function setForYouError(state: HomeTabState, message?: string): HomeTabState {
  return { ...state, forYouError: message };
}

export function setRecentError(state: HomeTabState, message?: string): HomeTabState {
  return { ...state, recentError: message };
}

export function setHomeRange(state: HomeTabState, range: TimeRangeT): HomeTabState {
  return { ...state, range };
}
