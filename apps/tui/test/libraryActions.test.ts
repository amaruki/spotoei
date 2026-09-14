import { describe, expect, test } from 'bun:test';
import { createLibraryActions } from '../src/main/library';
import type { AppContext } from '../src/main/types';
import type { LibraryPageResponseT } from 'spotoei-protocol';

describe('createLibraryActions loadMoreLibrary', () => {
  test('paginates past 50 items and deduplicates overlapping items', async () => {
    const fetchedOffsets: number[] = [];
    const setLibraryItemsCalls: { items: unknown[]; opts?: unknown }[] = [];
    const statusMessages: string[] = [];

    const mockLibraryManager = {
      async refresh() {},
      async getPage(collection: string, offset = 0, _limit = 50): Promise<LibraryPageResponseT> {
        fetchedOffsets.push(offset);
        if (offset === 0) {
          // Page 1: items 0 to 49
          const items = Array.from({ length: 50 }, (_, i) => ({
            id: `track-${i}`,
            uri: `spotify:track:${i}`,
            name: `Track ${i}`,
            durationMs: 180000,
            artists: [],
          }));
          return {
            collection: 'saved_tracks',
            items,
            total: 80,
            offset: 0,
            limit: 50,
            hasMore: true,
            nextOffset: 50,
          };
        }
        // Page 2: returns 35 items, where the first 5 are duplicates of Page 1 (e.g. track-45..track-49)
        const items = Array.from({ length: 35 }, (_, i) => ({
          id: `track-${45 + i}`,
          uri: `spotify:track:${45 + i}`,
          name: `Track ${45 + i}`,
          durationMs: 180000,
          artists: [],
        }));
        return {
          collection: 'saved_tracks',
          items,
          total: 80,
          offset: 50,
          limit: 50,
          hasMore: false,
          nextOffset: 80,
        };
      },
    };

    const mockUi = {
      setLibraryLoading() {},
      setStatus(msg: string) {
        statusMessages.push(msg);
      },
      setLibraryItems(items: unknown[], err?: unknown, opts?: unknown) {
        setLibraryItemsCalls.push({ items, opts });
      },
    };

    const state = {
      libraryItems: [] as Array<{ id: string }>,
      librarySection: 'saved_tracks',
      playback: null,
    };

    const ctx = {
      clients: {
        libraryManager: mockLibraryManager,
      },
      state,
      getUi: () => mockUi,
    } as unknown as AppContext;

    const actions = createLibraryActions(ctx);

    // 1. Initial load
    await actions.loadLibrary(false, 'saved_tracks');
    expect(fetchedOffsets).toEqual([0]);
    expect(state.libraryItems.length).toBe(50);
    expect(state.libraryItems[0]?.id).toBe('track-0');
    expect(state.libraryItems[49]?.id).toBe('track-49');

    // 2. Load more (page 2)
    await actions.loadMoreLibrary();
    expect(fetchedOffsets).toEqual([0, 50]);

    // 3. Deduplication check: 50 items originally + 30 new unique items (track-50..track-79) = 80 total
    expect(state.libraryItems.length).toBe(80);
    const ids = state.libraryItems.map((it: { id: string }) => it.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(80);

    // Check appended call passed append: true
    const lastCall = setLibraryItemsCalls[setLibraryItemsCalls.length - 1];
    expect((lastCall?.opts as { append?: boolean })?.append).toBe(true);
    expect((lastCall?.opts as { hasMore?: boolean })?.hasMore).toBe(false);
  });
});
