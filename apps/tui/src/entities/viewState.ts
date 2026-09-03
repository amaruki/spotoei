// Per-entity view state: selection, scroll, paging, release groups.
// One release group loads at a time; switching resets paging.

import type { ArtistReleaseGroupT } from 'spotoei-protocol';

export type EntityKind = 'artist' | 'album' | 'playlist';

export interface EntityView {
  kind: EntityKind;
  id: string;
  selected: number;
  scroll: number;
  loadedPages: number[];
  nextOffset: number;
  hasMore: boolean;
  loading: boolean;
  releaseGroup?: ArtistReleaseGroupT;
  lastError?: string;
}

export function createEntityView(kind: EntityKind, id: string): EntityView {
  return {
    kind,
    id,
    selected: 0,
    scroll: 0,
    loadedPages: [],
    nextOffset: 0,
    hasMore: true,
    loading: false,
    releaseGroup: kind === 'artist' ? 'album' : undefined,
  };
}

export function switchReleaseGroup(view: EntityView, group: ArtistReleaseGroupT): EntityView {
  return {
    ...view,
    releaseGroup: group,
    selected: 0,
    scroll: 0,
    loadedPages: [],
    nextOffset: 0,
    hasMore: true,
    lastError: undefined,
  };
}

export function nextArtistPageOffset(view: EntityView): number | null {
  if (!view.hasMore) return null;
  return view.nextOffset;
}
