import { describe, expect, it } from 'bun:test';

import { fetchAllPages } from '../src/webApi/paging';

describe('fetchAllPages', () => {
  it('fetches a known total in exact offset batches', async () => {
    const seen: Array<{ offset: number; limit: number }> = [];
    const result = await fetchAllPages(
      async (offset: number, limit: number) => {
        seen.push({ offset, limit });
        return { items: [`i${offset}`], total: 250 };
      },
      { startOffset: 100, pageLimit: 50, maxParallel: 8, knownTotal: 250 },
    );
    expect(seen).toEqual([
      { offset: 100, limit: 50 },
      { offset: 150, limit: 50 },
      { offset: 200, limit: 50 },
    ]);
    expect(result.items).toEqual(['i100', 'i150', 'i200']);
    expect(result.total).toBe(250);
  });

  it('stops at the first empty page when the total is unknown', async () => {
    const seen: number[] = [];
    const result = await fetchAllPages(
      async (offset: number) => {
        seen.push(offset);
        if (offset >= 100) return { items: [], total: -1 };
        return { items: [`i${offset}`], total: -1 };
      },
      { pageLimit: 50, maxParallel: 4 },
    );
    expect(result.items).toEqual(['i0', 'i50']);
    // First batch probes 0..150 (4 parallel); the empty page at 100 stops it.
    expect(seen).toEqual([0, 50, 100, 150]);
  });

  it('caps parallelism at maxParallel', async () => {
    let inFlight = 0;
    let maxSeen = 0;
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const gate = () => new Promise<void>((r) => setTimeout(r, 5));
    const result = await fetchAllPages(
      async (offset: number) => {
        inFlight += 1;
        maxSeen = Math.max(maxSeen, inFlight);
        await gate();
        inFlight -= 1;
        return { items: [`i${offset}`], total: 500 };
      },
      { pageLimit: 50, maxParallel: 3, knownTotal: 500 },
    );
    expect(maxSeen).toBe(3);
    expect(result.items).toHaveLength(10);
  });

  it('aborts without further fetches', async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = fetchAllPages(
      async (offset: number) => {
        calls += 1;
        await new Promise<void>((r) => setTimeout(r, 5));
        return { items: [`i${offset}`], total: 500 };
      },
      { pageLimit: 50, maxParallel: 2, knownTotal: 500, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('propagates page failures', async () => {
    await expect(
      fetchAllPages(
        async (offset: number) => {
          if (offset >= 50) throw new Error('boom');
          return { items: [`i${offset}`], total: 150 };
        },
        { pageLimit: 50, maxParallel: 2, knownTotal: 150 },
      ),
    ).rejects.toThrow('boom');
  });
});
