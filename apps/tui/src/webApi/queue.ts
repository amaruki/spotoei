// Queue endpoints (queue snapshot, add to queue).

import type { QueueItemT, QueueSnapshotT } from 'spotoei-protocol';
import { mapTrack } from './mappers';
import { pickObjectKey, toArray } from './shape';
import type { Transport } from './transport';

export class QueueEndpoints {
  constructor(private transport: Transport) {}

  async addToQueue(uri: string): Promise<boolean> {
    try {
      await this.transport.request(`/me/player/queue?uri=${encodeURIComponent(uri)}`, {}, 'POST');
      return true;
    } catch {
      return false;
    }
  }

  async getQueueSnapshot(): Promise<QueueSnapshotT | null> {
    try {
      const json = await this.transport.request('/me/player/queue');
      const currentlyPlayingRaw = pickObjectKey(json, 'currently_playing');
      const isTrack =
        currentlyPlayingRaw &&
        (pickObjectKey(currentlyPlayingRaw, 'currently_playing_type') === 'track' ||
          !pickObjectKey(currentlyPlayingRaw, 'currently_playing_type'));
      const current = isTrack ? mapTrack(currentlyPlayingRaw) : null;
      const rawQueue = toArray(pickObjectKey(json, 'queue'));
      const upcoming: QueueItemT[] = [];
      let idx = 0;
      for (const item of rawQueue) {
        const track = mapTrack(item);
        if (track) {
          upcoming.push({
            id: `${track.id}-${idx++}`,
            track,
            source: 'context',
            addedAt: Date.now(),
          });
        }
      }
      return {
        current,
        upcoming,
        revision: 0,
      };
    } catch {
      return null;
    }
  }
}
