import type { LibraryCollectionT } from 'spotoei-protocol';
import {
  initialCollections,
  markPageLoaded,
  markRefreshFailed,
  setCollectionLoading,
  structurizePlaylists,
  flattenPlaylistTree,
  toggleFolderExpanded,
  type CollectionMap,
  type PlaylistFolderNode,
  type PlaylistT,
} from '../library/collections';
import type { LibraryItemT } from '../ui';
import type { AppContext } from './types';
import { QUOTA_BANNER } from '../webApi/transport';
import { filterItemsInMemory } from '../search';
const PAGE_LIMIT = 50;

export function createLibraryActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;
  let collections: CollectionMap = initialCollections();
  const loadingMore = new Set<LibraryCollectionT>();
  let allItemsForSection: LibraryItemT[] = [];
  const loadLibrary = async (
    force = false,
    collection: LibraryCollectionT = 'saved_tracks',
  ): Promise<void> => {
    const ui = getUi();
    if (!ui) return;
    if (collections[collection].loading) return;
    collections = setCollectionLoading(collections, collection, true);
    const hadItems = state.libraryItems.length > 0 && state.librarySection === collection;
    if (!hadItems) ui.setLibraryLoading(true);
    ui.setStatus(`Loading ${collection}…`);
    try {
      if (force) {
        await clients.libraryManager.refresh(collection);
        collections = {
          ...collections,
          [collection]: {
            ...collections[collection],
            nextOffset: 0,
            nextCursor: undefined,
            hasMore: true,
            lastError: undefined,
          },
        };
      }
      const page = await clients.libraryManager.getPage(collection, 0, PAGE_LIMIT, force);
      const isStale = (page as { isStale?: boolean }).isStale ?? false;
      if (page.error) {
        collections = markRefreshFailed(collections, collection, page.error.message);
        if (!hadItems) ui.setLibraryItems([], page.error, { isStale });
        const banner =
          page.error.code === 'QUOTA_EXCEEDED' || page.error.code === 'API_QUOTA_EXCEEDED'
            ? QUOTA_BANNER
            : `Library error (${collection}): ${page.error.message}`;
        ui.setStatus(banner, true);
        return;
      }
      const nextOffset =
        (page as { nextOffset?: number }).nextOffset ?? page.offset + page.items.length;
      const nextCursor = (page as { nextCursor?: string }).nextCursor;
      collections = markPageLoaded(
        collections,
        collection,
        nextOffset,
        page.hasMore,
        nextCursor,
        page.total,
      );
      if (collection === 'playlists') {
        const tree = structurizePlaylists(page.items as PlaylistT[]);
        (state as unknown as Record<string, unknown>).playlistTree = tree;
        state.libraryItems = flattenPlaylistTree(tree) as LibraryItemT[];
      } else {
        state.libraryItems = page.items as LibraryItemT[];
      }
      allItemsForSection = [...state.libraryItems];
      if (clients.cache) {
        const accountId =
          (state.currentInfo?.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous';
        clients.cache.indexLibraryItems(accountId, collection, page.items);
      }
      state.librarySection = collection;
      ui.setLibraryItems(state.libraryItems, undefined, { hasMore: page.hasMore, isStale });
      const count = state.libraryItems.length;
      const totalHint = page.total > count ? ` of ${page.total}` : '';
      const moreHint = page.hasMore ? ' — scroll to load more' : '';
      ui.setStatus(
        count > 0
          ? `Loaded ${count}${totalHint} items from ${collection}${moreHint}.`
          : `No items in ${collection}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      collections = markRefreshFailed(collections, collection, msg);
      if (!hadItems) ui.setLibraryItems([], { code: 'LOAD_ERROR', message: msg });
      ui.setStatus(`Failed to load ${collection}: ${msg}`, true);
    } finally {
      collections = setCollectionLoading(collections, collection, false);
    }
  };

  const loadMoreLibrary = async (): Promise<void> => {
    const collection = state.librarySection;
    const cur = collections[collection];
    if (!cur.hasMore || cur.loading || loadingMore.has(collection)) return;
    const ui = getUi();
    if (!ui) return;
    loadingMore.add(collection);
    collections = setCollectionLoading(collections, collection, true);
    ui.setStatus(`Loading more ${collection}…`);
    try {
      const safeOffset = Math.max(0, cur.nextOffset);
      const safeLimit = Math.max(1, Math.min(PAGE_LIMIT, 50));
      const page = await clients.libraryManager.getPage(
        collection,
        safeOffset,
        safeLimit,
        false,
        cur.nextCursor,
      );
      const isStale = (page as { isStale?: boolean }).isStale ?? false;
      if (page.error) {
        collections = markRefreshFailed(collections, collection, page.error.message);
        const banner =
          page.error.code === 'QUOTA_EXCEEDED' || page.error.code === 'API_QUOTA_EXCEEDED'
            ? QUOTA_BANNER
            : `Library error (${collection}): ${page.error.message}`;
        ui.setStatus(banner, true);
        return;
      }
      if (page.items.length === 0) {
        collections = markPageLoaded(
          collections,
          collection,
          cur.nextOffset,
          false,
          cur.nextCursor,
          page.total,
        );
        ui.setStatus(`All ${state.libraryItems.length} items loaded from ${collection}.`);
        return;
      }
      const existingKeys = new Set<string>();
      for (const it of state.libraryItems) {
        const item = it as { id?: string; uri?: string };
        const key = item.id ?? item.uri;
        if (key) existingKeys.add(key);
      }
      const incoming = page.items as LibraryItemT[];
      const appended = incoming.filter((it) => {
        const item = it as { id?: string; uri?: string };
        const key = item.id ?? item.uri;
        return !key || !existingKeys.has(key);
      });
      state.libraryItems = [...state.libraryItems, ...appended];
      allItemsForSection = [...state.libraryItems];
      if (clients.cache) {
        const accountId =
          (state.currentInfo?.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous';
        clients.cache.indexLibraryItems(accountId, collection, appended);
      }
      const nextOffset =
        (page as { nextOffset?: number }).nextOffset ?? page.offset + page.items.length;
      const nextCursor = (page as { nextCursor?: string }).nextCursor;
      collections = markPageLoaded(
        collections,
        collection,
        nextOffset,
        page.hasMore,
        nextCursor,
        page.total,
      );
      try {
        (
          ui.setLibraryItems as unknown as (
            items: LibraryItemT[],
            err?: unknown,
            opts?: { append?: boolean; hasMore?: boolean; isStale?: boolean },
          ) => void
        )(appended, undefined, { append: true, hasMore: page.hasMore, isStale });
      } catch {
        ui.setLibraryItems(state.libraryItems, undefined, { hasMore: page.hasMore, isStale });
      }
      const totalHint = page.total > state.libraryItems.length ? ` of ${page.total}` : '';
      const moreHint = page.hasMore ? ' — scroll for more' : ' — all loaded';
      ui.setStatus(
        `Loaded ${state.libraryItems.length}${totalHint} items from ${collection}${moreHint}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      collections = markRefreshFailed(collections, collection, msg);
      ui.setStatus(`Failed to load more ${collection}: ${msg}`, true);
    } finally {
      loadingMore.delete(collection);
      collections = setCollectionLoading(collections, collection, false);
    }
  };

  const togglePlaylistFolder = (folderId: string): void => {
    const ui = getUi();
    if (!ui) return;
    const tree = (state as unknown as Record<string, unknown>).playlistTree as
      | Array<PlaylistFolderNode | PlaylistT>
      | undefined;
    if (!tree) return;
    const updatedTree = toggleFolderExpanded(tree, folderId);
    (state as unknown as Record<string, unknown>).playlistTree = updatedTree;
    state.libraryItems = flattenPlaylistTree(updatedTree) as LibraryItemT[];
    allItemsForSection = [...state.libraryItems];
    ui.setLibraryItems(state.libraryItems, undefined, {
      hasMore: collections.playlists.hasMore,
    });
  };

  const filterLocal = (query: string): LibraryItemT[] => {
    const ui = getUi();
    const q = query.trim();
    const collection = state.librarySection;
    const accountId =
      (state.currentInfo?.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous';

    if (allItemsForSection.length === 0 && state.libraryItems.length > 0) {
      allItemsForSection = [...state.libraryItems];
    }

    if (!q) {
      if (allItemsForSection.length > 0) {
        state.libraryItems = [...allItemsForSection];
      }
      ui?.setLibraryItems(state.libraryItems, undefined, {
        hasMore: collections[collection]?.hasMore ?? false,
      });
      return state.libraryItems;
    }

    let filtered: LibraryItemT[] = [];
    if (clients.cache) {
      try {
        filtered = clients.cache.searchLibrary<LibraryItemT>(accountId, q, [collection]);
      } catch {
        filtered = [];
      }
    }

    if (filtered.length === 0) {
      const source = allItemsForSection.length > 0 ? allItemsForSection : state.libraryItems;
      filtered = filterItemsInMemory(q, source);
    }

    state.libraryItems = filtered;
    ui?.setLibraryItems(filtered, undefined, { hasMore: false });
    ui?.setStatus(`Filtered ${filtered.length} items for "${q}"`);
    return filtered;
  };

  return { loadLibrary, loadMoreLibrary, togglePlaylistFolder, filterLibraryLocal: filterLocal };
}

export function filterLibraryLocal(
  query: string,
  items: readonly LibraryItemT[] | LibraryItemT[] = [],
): LibraryItemT[] {
  return filterItemsInMemory(query, items);
}
