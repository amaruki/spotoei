import type { LibraryItemT } from '../ui';
import type { AppContext } from './types';

export function createLibraryActions(ctx: AppContext) {
  const { clients, state, getUi } = ctx;

  const loadLibrary = async (force = false): Promise<void> => {
    const ui = getUi();
    if (!ui) return;
    ui.setLibraryLoading(true);
    ui.setStatus('Loading saved library tracks…');
    try {
      if (force) {
        await clients.libraryManager.refresh('saved_tracks');
      }
      const page = await clients.libraryManager.getPage('saved_tracks', 0, 50, force);
      if (page.error) {
        ui.setLibraryItems([], page.error);
        ui.setStatus(`Library error: ${page.error.message}`, true);
        return;
      }
      state.libraryItems = page.items as LibraryItemT[];
      ui.setLibraryItems(state.libraryItems);
      const count = state.libraryItems.length;
      ui.setStatus(
        count > 0
          ? `Loaded ${count} saved track${count === 1 ? '' : 's'}. Press Enter to play.`
          : 'Your Spotify library has no saved tracks.',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.setLibraryItems([], { code: 'LOAD_ERROR', message: msg });
      ui.setStatus(`Failed to load library: ${msg}`, true);
    }
  };

  return { loadLibrary };
}
