// Queue manager for the player's upcoming tracks. Maintains a monotonic
// revision id so consumers can detect snapshot updates. The next call to
// `refresh()` reconciles any optimistic local insert with the canonical
// Spotify queue response.

import { WebApiClient } from './webApi';
import type { CatalogTrackT, QueueSnapshotT, TrackT } from 'spotoei-protocol';

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
      // Only bump revision when content actually changed (hash comparison).
      const prevHash = JSON.stringify({
        current: this.snapshot.current?.id ?? null,
        upcoming: this.snapshot.upcoming.map((i) => i.track.id),
      });
      const nextHash = JSON.stringify({
        current: fresh.current?.id ?? null,
        upcoming: fresh.upcoming.map((i) => i.track.id),
      });
      const revision = prevHash === nextHash ? this.snapshot.revision : this.snapshot.revision + 1;
      this.snapshot = {
        current: fresh.current,
        upcoming: fresh.upcoming,
        revision,
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

// The snapshot the queue view should render. Playback here is local-first,
// so the Spotify cloud queue is empty whenever no Connect session is
// active — while the local pool holds what will actually play next.
// Prefer the cloud snapshot when it has content (Connect playback is
// authoritative there); otherwise build the view from local state so the
// page never shows "(queue empty)" while tracks are queued locally.
export function resolveQueueView(
  cloud: QueueSnapshotT,
  pool: CatalogTrackT[],
  playbackTrack?: TrackT | null,
): QueueSnapshotT {
  if (cloud.current || cloud.upcoming.length > 0) return cloud;
  const curUri = playbackTrack?.uri;
  const curIdx = curUri ? pool.findIndex((t) => t.uri === curUri) : -1;
  const current: CatalogTrackT | null =
    curIdx >= 0
      ? (pool[curIdx] as CatalogTrackT)
      : playbackTrack
        ? trackFromPlayback(playbackTrack)
        : null;
  const rest = curIdx >= 0 ? pool.slice(curIdx + 1) : pool;
  const now = Date.now();
  return {
    current,
    upcoming: rest.map((track, i) => ({
      id: `${track.id}-local-${i}`,
      track,
      source: 'context' as const,
      addedAt: now,
    })),
    revision: cloud.revision,
  };
}

function trackFromPlayback(track: TrackT): CatalogTrackT {
  const id = track.uri.startsWith('spotify:track:')
    ? track.uri.replace('spotify:track:', '')
    : track.uri;
  return {
    id,
    uri: track.uri,
    name: track.name,
    artists:
      track.artists.length > 0
        ? track.artists.map((name) => ({
            id: 'unknown',
            name,
            uri: 'spotify:artist:unknown',
          }))
        : [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }],
    albumName: track.album,
    durationMs: track.durationMs,
  };
}
