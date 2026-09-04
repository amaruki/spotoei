// Per-collection Library state: selection, scroll, paging, loading, error.
// r refreshes the active collection only; failure preserves loaded content.

import type { LibraryCollectionT } from 'spotoei-protocol';

export interface CollectionState {
  selected: number;
  scroll: number;
  nextOffset: number;
  hasMore: boolean;
  loading: boolean;
  lastError?: string;
}

export type CollectionMap = Record<LibraryCollectionT, CollectionState>;

export function initialCollectionState(): CollectionState {
  return { selected: 0, scroll: 0, nextOffset: 0, hasMore: true, loading: false };
}

export function initialCollections(): CollectionMap {
  return {
    saved_tracks: initialCollectionState(),
    saved_albums: initialCollectionState(),
    followed_artists: initialCollectionState(),
    playlists: initialCollectionState(),
  };
}

export function markRefreshFailed(
  map: CollectionMap,
  collection: LibraryCollectionT,
  message: string,
): CollectionMap {
  return {
    ...map,
    [collection]: { ...map[collection], loading: false, lastError: message },
  };
}

export function markPageLoaded(
  map: CollectionMap,
  collection: LibraryCollectionT,
  nextOffset: number,
  hasMore: boolean,
): CollectionMap {
  return {
    ...map,
    [collection]: {
      ...map[collection],
      nextOffset,
      hasMore,
      loading: false,
      lastError: undefined,
    },
  };
}

export function setCollectionLoading(
  map: CollectionMap,
  collection: LibraryCollectionT,
  loading: boolean,
): CollectionMap {
  return { ...map, [collection]: { ...map[collection], loading } };
}

export function resetCollection(map: CollectionMap, collection: LibraryCollectionT): CollectionMap {
  return {
    ...map,
    [collection]: { ...initialCollectionState(), lastError: map[collection].lastError },
  };
}

export function activeRefreshTarget(active: LibraryCollectionT): LibraryCollectionT {
  return active;
}
