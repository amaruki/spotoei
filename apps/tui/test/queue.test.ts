import { describe, expect, test } from 'bun:test';
import { QueueManager } from '../src/queue';
import { WebApiClient } from '../src/webApi';
import type { QueueSnapshotT } from 'spotoei-protocol';

describe('QueueManager', () => {
  test('returns empty initial snapshot', () => {
    const fakeWebApi = {} as WebApiClient;
    const manager = new QueueManager({ webApi: fakeWebApi });
    const snap = manager.getSnapshot();
    expect(snap.current).toBeNull();
    expect(snap.upcoming.length).toBe(0);
    expect(snap.revision).toBe(0);
  });

  test('refresh updates snapshot with API response', async () => {
    let callCount = 0;
    const fakeWebApi = {
      async getQueueSnapshot(): Promise<QueueSnapshotT> {
        callCount++;
        return {
          current: {
            id: 'now1',
            uri: 'spotify:track:now1',
            name: 'Now Playing',
            artists: [{ id: 'a1', name: 'Artist', uri: 'spotify:artist:a1' }],
            albumId: 'al1',
            albumName: 'Album',
            durationMs: 180000,
          },
          upcoming: [],
          revision: 1,
        };
      },
    } as unknown as WebApiClient;

    const manager = new QueueManager({ webApi: fakeWebApi });
    const snap = await manager.refresh();
    expect(snap.current?.id).toBe('now1');
    expect(callCount).toBe(1);
  });

  test('add bumps revision and does not insert a placeholder', async () => {
    const fakeWebApi = {
      async addToQueue(uri: string): Promise<boolean> {
        return uri === 'spotify:track:t1';
      },
    } as unknown as WebApiClient;

    const manager = new QueueManager({ webApi: fakeWebApi });
    const initial = manager.getSnapshot();
    const initialRev = initial.revision;
    const initialCount = initial.upcoming.length;

    const ok = await manager.add('spotify:track:t1');
    expect(ok).toBe(true);

    const after = manager.getSnapshot();
    expect(after.upcoming.length).toBe(initialCount);
    expect(after.revision).toBe(initialRev + 1);
  });

  test('add does not bump revision when API fails', async () => {
    const fakeWebApi = {
      async addToQueue(): Promise<boolean> {
        return false;
      },
    } as unknown as WebApiClient;

    const manager = new QueueManager({ webApi: fakeWebApi });
    const initial = manager.getSnapshot();
    const initialRev = initial.revision;

    const ok = await manager.add('spotify:track:t1');
    expect(ok).toBe(false);

    const after = manager.getSnapshot();
    expect(after.revision).toBe(initialRev);
    expect(after.upcoming.length).toBe(initial.upcoming.length);
  });

  test('subscribers are notified on snapshot change', async () => {
    let received: QueueSnapshotT | null = null;
    const fakeWebApi = {
      async getQueueSnapshot(): Promise<QueueSnapshotT> {
        return {
          current: null,
          upcoming: [
            {
              id: 'q1',
              track: {
                id: 't1',
                uri: 'spotify:track:t1',
                name: 'Test',
                artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
                albumId: 'al1',
                albumName: 'Al',
                durationMs: 1000,
              },
              source: 'context',
              addedAt: 1,
            },
          ],
          revision: 5,
        };
      },
    } as unknown as WebApiClient;

    const manager = new QueueManager({ webApi: fakeWebApi });
    const unsubscribe = manager.subscribe((snap) => {
      received = snap;
    });
    expect(received).not.toBeNull();
    expect(received!.upcoming.length).toBe(0);

    await manager.refresh();
    expect(received!.revision).toBe(1);
    unsubscribe();
  });
});
