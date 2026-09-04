import type { LibraryCollectionT } from 'spotoei-protocol';
import { initialCollections, markRefreshFailed, type CollectionMap } from '../library/collections';
import type { LibraryItemT } from '../ui';
import type { AppContext } from './types';

export function createLibraryActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;
  let collections: CollectionMap = initialCollections();

  const loadLibrary = async (
    force = false,
    collection: LibraryCollectionT = 'saved_tracks',
  ): Promise<void> => {
    const ui = getUi();
    if (!ui) return;
    const hadItems = state.libraryItems.length > 0;
    if (!hadItems) ui.setLibraryLoading(true);
    ui.setStatus(`Loading ${collection}…`);
    try {
      if (force) {
        await clients.libraryManager.refresh(collection);
      }
      const page = await clients.libraryManager.getPage(collection, 0, 50, force);
      if (page.error) {
        collections = markRefreshFailed(collections, collection, page.error.message);
        if (!hadItems) ui.setLibraryItems([], page.error);
        ui.setStatus(`Library error (${collection}): ${page.error.message}`, true);
        return;
      }
      state.libraryItems = page.items as LibraryItemT[];
      state.librarySection = collection;
      ui.setLibraryItems(state.libraryItems);
      const count = state.libraryItems.length;
      ui.setStatus(
        count > 0
          ? `Loaded ${count} item${count === 1 ? '' : 's'} from ${collection}.`
          : `No items in ${collection}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      collections = markRefreshFailed(collections, collection, msg);
      if (!hadItems) ui.setLibraryItems([], { code: 'LOAD_ERROR', message: msg });
      ui.setStatus(`Failed to load ${collection}: ${msg}`, true);
    }
  };

  return { loadLibrary };
}
