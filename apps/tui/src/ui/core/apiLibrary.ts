// @ts-nocheck
// Library-list and queue setters extracted from api.ts for the 300 LoC cap.

import { fg, t } from '@opentui/core';
import type { QueueSnapshotT } from 'spotoei-protocol';

import { formatArtists } from '../formatters';
import { COLOR_DIM } from '../theme';
import { libraryItemOptions } from '../views/library';
import { restoreListPosition } from './panelSetters';
import type { LibraryItemT, UiCoreContext } from './types';

export function createLibrarySetters(ctx: UiCoreContext) {
  const { built, state } = ctx;

  return {
    setLibraryItems(
      items: LibraryItemT[],
      error?: { code: string; message: string },
      opts?: {
        append?: boolean;
        hasMore?: boolean;
        isStale?: boolean;
        savedIds?: Set<string>;
        playingUri?: string | null;
      },
    ): void {
      const playingUri = opts?.playingUri ?? state.playback?.track?.uri ?? null;
      const savedIds =
        opts?.savedIds ??
        (() => {
          const s = new Set<string>();
          for (const it of items as Array<{ uri?: string; id?: string }>) {
            if (it.uri) s.add(it.uri);
            if (it.id) s.add(it.id);
          }
          for (const it of ctx.currentLibraryItems.value as Array<{ uri?: string; id?: string }>) {
            if (it.uri) s.add(it.uri);
            if (it.id) s.add(it.id);
          }
          return s;
        })();
      const isStale = opts?.isStale;
      const hasMore = opts?.hasMore;
      if (hasMore !== undefined) ctx.libraryHasMore.value = hasMore;
      if (opts?.append) {
        const prevIdx = built.libraryList.getSelectedIndex();
        const existingKeys = new Set<string>();
        for (const it of ctx.currentLibraryItems.value as Array<{ id?: string; uri?: string }>) {
          const key = it.id ?? it.uri;
          if (key) existingKeys.add(key);
        }
        const appended = items.filter((it) => {
          const key = (it as { id?: string; uri?: string }).id ?? (it as { uri?: string }).uri;
          return !key || !existingKeys.has(key);
        });
        ctx.currentLibraryItems.value = [...ctx.currentLibraryItems.value, ...appended] as never;
        built.libraryList.options = libraryItemOptions(ctx.currentLibraryItems.value, error, {
          savedIds,
          playingUri,
          isStale,
          hasMore,
        });
        const max = Math.max(0, built.libraryList.options.length - 1);
        built.libraryList.setSelectedIndex(Math.min(Math.max(0, prevIdx), max));
        return;
      }
      const prevIdx = built.libraryList.getSelectedIndex();
      const prevId = (ctx.currentLibraryItems.value[prevIdx] as { id?: string } | undefined)?.id;
      ctx.currentLibraryItems.value = items as never;
      built.libraryList.options = libraryItemOptions(items, error, {
        savedIds,
        playingUri,
        isStale,
        hasMore,
      });
      if (prevId) {
        const newIdx = items.findIndex((it) => it.id === prevId);
        if (newIdx >= 0) {
          built.libraryList.setSelectedIndex(newIdx);
          ctx.positions.save(ctx.route.current, { selected: newIdx, scroll: 0 });
          return;
        }
      }
      restoreListPosition(ctx, built.libraryList);
    },
    setLibraryLoading(loading: boolean): void {
      if (loading) {
        // Stale-refreshing: keep cached rows visible, announce refresh in status.
        const hasRows = built.libraryList.options.some(
          (o) => !o.name.startsWith('Loading') && !o.name.startsWith('(library empty)'),
        );
        if (hasRows) {
          built.statusText.content = t`${fg(COLOR_DIM)('refreshing library…')}`;
          return;
        }
        built.statusText.content = t`${fg(COLOR_DIM)('loading library…')}`;
        built.libraryList.options = [
          { name: 'Loading Library…', description: 'Fetching your saved tracks from Spotify' },
        ];
        built.libraryList.setSelectedIndex(0);
      }
    },
    setLibraryLines(lines: string[], empty: boolean): void {
      if (empty || lines.length === 0) {
        built.libraryList.options = [{ name: '(empty)', description: 'Press r to refresh' }];
      } else {
        built.libraryList.options = lines.map((line) => ({
          name: line,
          description: '',
        }));
      }
    },
    setQueueSnapshot(snap: QueueSnapshotT): void {
      const items: { name: string; description: string }[] = [];
      if (snap.current) {
        items.push({
          name: `▶ ${snap.current.name}`,
          description: formatArtists(snap.current.artists),
        });
      }
      for (const item of snap.upcoming) {
        const track = item.track;
        items.push({
          name: track.name,
          description: `${formatArtists(track.artists)} (upcoming)`,
        });
      }
      if (items.length === 0) {
        built.queueList.options = [{ name: '(queue empty)', description: 'Add tracks via search' }];
      } else {
        built.queueList.options = items;
      }
      if (built.queueList.selectedIndex >= built.queueList.options.length) {
        built.queueList.setSelectedIndex(0);
      }
    },
  };
}
