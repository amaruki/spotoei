// @ts-nocheck
import type { BrowseEntryT, CatalogTrackT } from 'spotoei-protocol';

let browseMode: 'entries' | 'tracks' = 'entries';
let browseTracks: CatalogTrackT[] = [];
let browseTracksKey = '';
let liveFallbackBanner = false;
// Entries currently rendered in entries-mode that do not come from the
// static registry (e.g. live Spotify category playlists). Selections
// resolve against these first so dynamic rows activate correctly.
let dynamicEntries: BrowseEntryT[] = [];
let dynamicEntriesKey = '';
// Monotonic token so out-of-order live responses never paint stale data
// when the user jumps between categories quickly.
let liveNavSeq = 0;

export function isBrowseTracksMode(): boolean {
  return browseMode === 'tracks';
}
export function getBrowseTrack(index: number): CatalogTrackT | undefined {
  return browseTracks[index];
}
export function wasBrowseLiveFallback(): boolean {
  return liveFallbackBanner;
}
export function setBrowseMode(mode: 'entries' | 'tracks'): void {
  browseMode = mode;
}
export function getBrowseTracks(): CatalogTrackT[] {
  return browseTracks;
}
export function setBrowseTracks(tracks: CatalogTrackT[]): void {
  browseTracks = tracks;
}
export function getBrowseTracksKey(): string {
  return browseTracksKey;
}
export function setBrowseTracksKey(key: string): void {
  browseTracksKey = key;
}
export function setLiveFallbackBanner(value: boolean): void {
  liveFallbackBanner = value;
}
export function nextLiveNavSeq(): number {
  return ++liveNavSeq;
}
export function getLiveNavSeq(): number {
  return liveNavSeq;
}

// Categories currently rendered at the browse root (live or static).
// Root-level selection resolves against these so a live list never
// misfires into the static registry at the same index.
let displayedCategories: Array<{ id: string; label: string }> = [];

export function getDisplayedCategory(index: number): { id: string; label: string } | undefined {
  return displayedCategories[index];
}
export function setDisplayedCategories(categories: Array<{ id: string; label: string }>): void {
  displayedCategories = categories;
}

export function browseEntriesKey(path: { category?: string; entry?: string }): string {
  return `${path.category ?? ''}:${path.entry ?? ''}`;
}

export function setDynamicEntries(key: string, entries: BrowseEntryT[]): void {
  dynamicEntriesKey = key;
  dynamicEntries = entries;
}

export function clearDynamicEntries(): void {
  dynamicEntries = [];
  dynamicEntriesKey = '';
}

export function getDynamicEntry(key: string, index: number): BrowseEntryT | undefined {
  if (!key || dynamicEntriesKey !== key) return undefined;
  return dynamicEntries[index];
}

export function resetBrowseLevel(): void {
  browseMode = 'entries';
  browseTracks = [];
  browseTracksKey = '';
  clearDynamicEntries();
}
