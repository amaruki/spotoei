// @ts-nocheck
// Browse-list and context-menu setters extracted from api.ts for the
// 300 LoC cap.

import { formatArtists } from '../formatters';
import type { ContextTarget } from '../types';
import { browseCategoryOptions, browseEntryOptions } from '../views/browseView';
import { resolveContextTarget } from './contextMenu';
import type { UiCoreContext } from './types';

export function createBrowseSetters(ctx: UiCoreContext) {
  const { built } = ctx;
  const { helpers } = ctx;

  return {
    setBrowseCategories(cats): void {
      ctx.currentRouteItems.value = cats as unknown[];
      built.browseList.options = browseCategoryOptions(cats as never);
      built.browseList.setSelectedIndex(0);
    },
    setBrowseEntries(entries): void {
      ctx.currentRouteItems.value = entries as unknown[];
      built.browseList.options = browseEntryOptions(entries as never);
      built.browseList.setSelectedIndex(0);
    },
    setBrowseTracks(
      tracks: Array<{
        id: string;
        uri: string;
        name: string;
        artists: Array<{ name: string }>;
        durationMs?: number;
      }>,
    ): void {
      ctx.currentRouteItems.value = tracks as unknown[];
      built.browseList.options = tracks.map((track) => ({
        name: track.name,
        description: formatArtists(track.artists),
      }));
      built.browseList.setSelectedIndex(0);
    },
    openContextMenu(title, items): void {
      helpers.openContextMenu(title, items);
    },
    closeContextMenu(): void {
      helpers.closeContextMenu();
    },
    isContextMenuOpen(): boolean {
      return helpers.isContextMenuOpen();
    },
    getContextTarget(): ContextTarget | null {
      return resolveContextTarget(ctx);
    },
  };
}
