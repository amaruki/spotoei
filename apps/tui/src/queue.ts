// Queue manager for the player's upcoming tracks. Maintains a monotonic
// revision id so consumers can detect snapshot updates. The next call to
// `refresh()` reconciles any optimistic local insert with the canonical
// Spotify queue response.

import { WebApiClient } from './webApi';
import type { QueueSnapshotT } from 'spotoei-protocol';

export interface QueueManagerOptions {
  webApi: WebApiClient;
}

export class QueueManager {
  private webApi: WebApiClient;
  private snapshot: QueueSnapshotT = { current: null, upcoming: [], revision: 0 };
  private listeners: Set<(snap: QueueSnapshotT) => void> = new Set();
  private refreshSeq = 0;

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
    const mySeq = ++this.refreshSeq;
    const fresh = await this.webApi.getQueueSnapshot();
    if (mySeq !== this.refreshSeq) {
      // A newer refresh started after this one; drop stale result.
      return this.snapshot;
    }
    if (fresh) {
      this.snapshot = {
        current: fresh.current,
        upcoming: fresh.upcoming,
        revision: this.snapshot.revision + 1,
      };
      for (const listener of this.listeners) listener(this.snapshot);
    }
    return this.snapshot;
  }

  async add(trackUri: string): Promise<boolean> {
    const ok = await this.webApi.addToQueue(trackUri);
    if (ok) {
      // Bump revision; refresh() will replace the snapshot with the
      // canonical Spotify queue on the next call so the local count
      // converges to the server's view.
      this.snapshot = {
        ...this.snapshot,
        revision: this.snapshot.revision + 1,
      };
      for (const listener of this.listeners) listener(this.snapshot);
    }
    return ok;
  }
}
