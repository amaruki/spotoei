import type { BrowseEntryT, BrowsePathT, HomeTabT } from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { browseResultsLabel, shouldFetchBrowseEntry } from '../browse/results';
import { getBrowseConfig } from '../config';
import type { Ui } from '../ui/types';

export type BrowseNav =
  | {
      kind: 'route';
      route:
        | { kind: 'search'; query: string }
        | { kind: 'playlist'; id: string }
        | { kind: 'library'; section: 'playlists' }
        | { kind: 'queue' }
        | { kind: 'home'; tab: HomeTabT; browse?: BrowsePathT };
      note?: string;
    }
  | { kind: 'message'; text: string; persist?: boolean };

// Pure selection resolution for the browse list. Categories navigate
// deeper; entries activate their source; disabled entries explain
// themselves and never issue API requests.
export function resolveBrowseSelection(
  path: { category?: string; entry?: string },
  index: number,
): BrowseNav {
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    const cat = categories[index];
    if (!cat) return { kind: 'message', text: 'Unknown browse category' };
    return {
      kind: 'route',
      route: { kind: 'home', tab: 'browse', browse: { category: cat.id } },
    };
  }
  const cat = categories.find((c) => c.id === path.category);
  const entry = cat?.entries[index] as BrowseEntryT | undefined;
  if (!entry) return { kind: 'message', text: 'Unknown browse entry' };
  const nav = activateBrowseEntry(entry);
  if (nav.kind === 'route') {
    const trail = browseBreadcrumb({ category: cat?.id, entry: entry.id });
    nav.note = entry.source.kind === 'search' ? `${trail} — ${browseResultLabelFor(entry)}` : trail;
  }
  return nav;
}

export function activateBrowseEntry(entry: BrowseEntryT): BrowseNav {
  if (!shouldFetchBrowseEntry(entry)) {
    return {
      kind: 'message',
      text: `${entry.label} is unavailable — configure sources in Settings, then retry`,
      persist: true,
    };
  }
  const source = entry.source;
  switch (source.kind) {
    case 'search':
      return {
        kind: 'route',
        route: { kind: 'search', query: source.query },
        note: browseResultLabelFor(entry),
      };
    case 'playlist': {
      const id = source.playlistUri.split(':').pop() ?? '';
      if (!id) {
        return {
          kind: 'message',
          text: `Invalid playlist reference for ${entry.label}`,
          persist: true,
        };
      }
      return { kind: 'route', route: { kind: 'playlist', id } };
    }
    case 'library':
      return { kind: 'route', route: { kind: 'library', section: 'playlists' } };
    case 'top_artists':
      return { kind: 'route', route: { kind: 'home', tab: 'for_you' } };
    case 'action':
      return { kind: 'route', route: { kind: 'queue' } };
  }
}

export function browseBreadcrumb(path: { category?: string; entry?: string }): string {
  const categories = buildBrowseCategories(getBrowseConfig());
  const cat = categories.find((c) => c.id === path.category);
  const entry = cat?.entries.find((e) => e.id === path.entry);
  return ['Browse', cat?.label, entry?.label].filter(Boolean).join(' › ');
}

export function browseResultLabelFor(entry: BrowseEntryT): string {
  return `${browseResultsLabel(entry)}: ${entry.label}`;
}

// Render the category or entry level into the shared browse list.
export function ensureBrowseLevel(ui: Ui, path: { category?: string; entry?: string }): void {
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    ui.setBrowseCategories(categories);
    return;
  }
  const cat = categories.find((c) => c.id === path.category);
  if (!cat) {
    ui.setStatus(`Unknown browse category: ${path.category}`, true);
    return;
  }
  if (!path.entry) {
    ui.setBrowseEntries(cat.entries);
    return;
  }
  const entry = cat.entries.find((e) => e.id === path.entry);
  if (!entry) {
    ui.setStatus(`Unknown browse entry: ${path.entry}`, true);
  }
}
