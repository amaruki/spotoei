// Browse view navigation state: category list -> entry list -> results.
// Selection and scroll are stored per browse key so returning restores them.

import type { BrowsePathT } from 'spotoei-protocol';

export type BrowseLevel = 'categories' | 'entries' | 'results';

export interface BrowseViewState {
  path: BrowsePathT;
  selections: Record<string, { selected: number; scroll: number }>;
}

export function createInitialBrowseState(): BrowseViewState {
  return { path: {}, selections: {} };
}

export function browseLevel(path: BrowsePathT): BrowseLevel {
  if (path.category && path.entry) return 'results';
  if (path.category) return 'entries';
  return 'categories';
}

export function enterCategory(state: BrowseViewState, category: string): BrowseViewState {
  return { ...state, path: { category } };
}

export function enterEntry(
  state: BrowseViewState,
  category: string,
  entry: string,
): BrowseViewState {
  return { ...state, path: { category, entry } };
}

export function escapeBrowse(state: BrowseViewState): BrowseViewState {
  const level = browseLevel(state.path);
  if (level === 'results' && state.path.category) {
    return { ...state, path: { category: state.path.category } };
  }
  if (level === 'entries') {
    return { ...state, path: {} };
  }
  return state;
}

export function saveBrowseSelection(
  state: BrowseViewState,
  key: string,
  selected: number,
  scroll: number,
): BrowseViewState {
  return { ...state, selections: { ...state.selections, [key]: { selected, scroll } } };
}

export function restoreBrowseSelection(
  state: BrowseViewState,
  key: string,
): { selected: number; scroll: number } {
  return state.selections[key] ?? { selected: 0, scroll: 0 };
}
