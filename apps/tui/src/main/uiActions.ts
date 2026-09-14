import type { LibraryCollectionT } from 'spotoei-protocol';
import type { createUi } from '../ui';
import type { PlayTrackOpts } from './playback';

export interface UiInitActions {
  triggerAuth: () => Promise<void>;
  triggerLogout: () => Promise<void>;
  handleSaveClientId: (id: string) => Promise<void>;
  loadLibrary: (force?: boolean, collection?: LibraryCollectionT) => Promise<void>;
  loadMoreLibrary?: () => Promise<void>;
  togglePlaylistFolder?: (folderId: string) => void;
  loadCurrentLyrics: (force?: boolean) => Promise<void>;
  updateQueueView: () => Promise<void>;
  ensureAutoplayTracks: () => Promise<void>;
  playRadio?: (opts: { seedUri: string; title?: string }) => Promise<void>;
  playTrackOrContext: (opts: PlayTrackOpts) => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  toggleRepeat: () => Promise<void>;
  toggleAutoplay: () => Promise<void>;
  seekRelative: (deltaMs: number) => Promise<void>;
  changeVolume: (delta: number) => Promise<void>;
  handleKey: (key: Parameters<Parameters<typeof createUi>[1]['onKey']>[0]) => void;
}
