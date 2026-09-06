import type { BrowseCategoryT, BrowseEntryT } from 'spotoei-protocol';

export function browseCategoryOptions(categories: BrowseCategoryT[]): Array<{
  name: string;
  description: string;
}> {
  return categories.map((c) => ({
    name: `▸ ${c.label}`,
    description: c.entries.length > 0 ? `${c.entries.length} entries` : 'Live from Spotify',
  }));
}

export function browseEntryOptions(entries: BrowseEntryT[]): Array<{
  name: string;
  description: string;
}> {
  return entries.map((e) => ({
    name: e.enabled ? `• ${e.label}` : `○ ${e.label} (unavailable)`,
    description: e.enabled ? e.description : `${e.description} — see Settings`,
  }));
}
