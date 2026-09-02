// Queue manager for the player's upcoming tracks. Maintains a revision id so
// consumers can detect snapshot updates and detect when their cached state
// has been invalidated by API mutations.

import { WebApiClient } from './webApi';
import type { QueueSnapshotT, QueueItemT } from 'spotoei-protocol';

export interface QueueManagerOptions {
  webApi: WebApiClient;
}

export class QueueManager {
  private webApi: WebApiClient;
  private snapshot: QueueSnapshotT = { current: null, upcoming: [], revision: 0 };
  private listeners: Set<(snap: QueueSnapshotT) => void> = new Set();

  constructor(opts: QueueManagerOptions) {
    this.webApi = opts.webApi;
  }

  getSnapshot(): QueueSnapshotT {
    return this.snapshot;
  }

  subscribe(listener: (snap: QueueSnapshotT) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async refresh(): Promise<QueueSnapshotT> {
    const fresh = await this.webApi.getQueueSnapshot();
    if (fresh) {
      this.snapshot = fresh;
      for (const listener of this.listeners) listener(this.snapshot);
    }
    return this.snapshot;
  }

  async add(trackUri: string): Promise<boolean> {
    const ok = await this.webApi.addToQueue(trackUri);
    if (ok) {
      // Local optimistic insert so the next read reflects the addition even
      // if the API rejects the subsequent GET. The list refresh command may
      // re-validate.
      const tempItem: QueueItemT = {
        id: `optimistic-${Date.now()}`,
        track: {
          id: trackUri.replace(/^spotify:track:/, ''),
          uri: trackUri,
          name: 'Pending…',
          artists: [
            { id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' },
          ],
          albumId: 'unknown',
          albumName: 'Unknown',
          durationMs: 0,
        },
        source: 'user',
        addedAt: Date.now(),
      };
      this.snapshot = {
        ...this.snapshot,
        upcoming: [...this.snapshot.upcoming, tempItem],
        revision: this.snapshot.revision + 1,
      };
      for (const listener of this.listeners) listener(this.snapshot);
    }
    return ok;
  }

  setShuffle(state: boolean): Promise<boolean> {
    return this.webApi.setShuffle(state);
  }

  setRepeat(state: 'off' | 'track' | 'context'): Promise<boolean> {
    return this.webApi.setRepeat(state);
  }
}
