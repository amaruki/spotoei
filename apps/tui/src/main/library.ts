import type { LibraryCollectionT } from 'spotoei-protocol';
import {
  initialCollections,
  markPageLoaded,
  markRefreshFailed,
  setCollectionLoading,
  type CollectionMap,
} from '../library/collections';
import type { LibraryItemT } from '../ui';
import type { AppContext } from './types';

const PAGE_LIMIT = 50;

export function createLibraryActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;
  let collections: CollectionMap = initialCollections();
  const loadingMore = new Set<LibraryCollectionT>();

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
        collections = { ...collections, [collection]: { ...collections[collection], nextOffset: 0, hasMore: true, lastError: undefined } };
      }
      const page = await clients.libraryManager.getPage(collection, 0, PAGE_LIMIT, force);
      if (page.error) {
        collections = markRefreshFailed(collections, collection, page.error.message);
        if (!hadItems) ui.setLibraryItems([], page.error);
        const banner = page.error.code === 'QUOTA_EXCEEDED' ? `Library quota exceeded (${collection}) — try again later` : `Library error (${collection}): ${page.error.message}`;
        ui.setStatus(banner, true);
        return;
      }
      collections = markPageLoaded(collections, collection, page.offset + page.items.length, page.hasMore);
      state.libraryItems = page.items as LibraryItemT[];
      state.librarySection = collection;
      ui.setLibraryItems(state.libraryItems);
      const count = state.libraryItems.length;
      const moreHint = page.hasMore ? ' — scroll to load more' : '';
      ui.setStatus(
        count > 0
          ? `Loaded ${count} item${count === 1 ? '' : 's'} from ${collection}${moreHint}.`
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
      const page = await clients.libraryManager.getPage(collection, cur.nextOffset, PAGE_LIMIT);
      if (page.error) {
        collections = markRefreshFailed(collections, collection, page.error.message);
        const banner = page.error.code === 'QUOTA_EXCEEDED' ? `Quota exceeded loading ${collection}` : `Library error (${collection}): ${page.error.message}`;
        ui.setStatus(banner, true);
        return;
      }
      if (page.items.length === 0) {
        collections = markPageLoaded(collections, collection, cur.nextOffset, false);
        ui.setStatus(`All ${state.libraryItems.length} items loaded from ${collection}.`);
        return;
      }
      const appended = page.items as LibraryItemT[];
      state.libraryItems = [...state.libraryItems, ...appended];
      collections = markPageLoaded(collections, collection, page.offset + appended.length, page.hasMore);
      try {
        (ui.setLibraryItems as unknown as (items: LibraryItemT[], err?: unknown, opts?: { append?: boolean }) => void)(appended, undefined, { append: true });
      } catch {
        ui.setLibraryItems(state.libraryItems);
      }
      const moreHint = page.hasMore ? ' — scroll for more' : ' — all loaded';
      ui.setStatus(`Loaded ${state.libraryItems.length} items from ${collection}${moreHint}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      collections = markRefreshFailed(collections, collection, msg);
      ui.setStatus(`Failed to load more ${collection}: ${msg}`, true);
    } finally {
      loadingMore.delete(collection);
      collections = setCollectionLoading(collections, collection, false);
    }
  };

  return { loadLibrary, loadMoreLibrary };
}
