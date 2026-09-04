import { describe, expect, it } from 'bun:test';
import type { LibraryMembershipT } from 'spotoei-protocol';

import { Cache } from '../src/cache';
import {
  checkMembershipBatched,
  inferKind,
  membershipFor,
  MEMBERSHIP_BATCH_SIZE,
  mutateUrisWithPreservation,
} from '../src/entityMutations';
import type { WebApiClient } from '../src/webApi';

const createMockClient = (overrides: Partial<WebApiClient> = {}): WebApiClient => {
  return {
    checkMembership: async (uris: string[]) => uris.map(() => false),
    saveUris: async () => true,
    removeUris: async () => true,
    ...overrides,
  } as unknown as WebApiClient;
};

describe('inferKind', () => {
  it('infers track from spotify:track URI', () => {
    expect(inferKind('spotify:track:abc')).toBe('track');
  });
  it('infers album from spotify:album URI', () => {
    expect(inferKind('spotify:album:def')).toBe('album');
  });
  it('infers artist from spotify:artist URI', () => {
    expect(inferKind('spotify:artist:xyz')).toBe('artist');
  });
  it('infers playlist from spotify:playlist URI', () => {
    expect(inferKind('spotify:playlist:p1')).toBe('playlist');
  });
  it('falls back to track for unknown URIs', () => {
    expect(inferKind('garbage')).toBe('track');
  });
  it('handles nested URIs by prefix', () => {
    expect(inferKind('spotify:track:abc:def')).toBe('track');
  });
});

describe('membershipFor', () => {
  const memberships: LibraryMembershipT[] = [
    { uri: 'spotify:track:1', kind: 'track', state: 'saved' },
    { uri: 'spotify:album:1', kind: 'album', state: 'not_saved' },
    { uri: 'spotify:artist:1', kind: 'artist', state: 'unknown' },
  ];

  it('returns the state for a known URI', () => {
    expect(membershipFor(memberships, 'spotify:track:1')).toBe('saved');
    expect(membershipFor(memberships, 'spotify:album:1')).toBe('not_saved');
    expect(membershipFor(memberships, 'spotify:artist:1')).toBe('unknown');
  });

  it('returns unknown for a URI not in the list', () => {
    expect(membershipFor(memberships, 'spotify:track:999')).toBe('unknown');
  });

  it('returns unknown for empty membership list', () => {
    expect(membershipFor([], 'spotify:track:1')).toBe('unknown');
  });
});

describe('MEMBERSHIP_BATCH_SIZE', () => {
  it('is a positive number <= 50', () => {
    expect(typeof MEMBERSHIP_BATCH_SIZE).toBe('number');
    expect(MEMBERSHIP_BATCH_SIZE).toBeGreaterThan(0);
    expect(MEMBERSHIP_BATCH_SIZE).toBeLessThanOrEqual(50);
  });
});

describe('mutateUrisWithPreservation', () => {
  it('saves all URIs in a single batch when below threshold', async () => {
    let saveBatch: string[] | undefined;
    const client = createMockClient({
      saveUris: async (uris) => {
        saveBatch = uris;
        return true;
      },
    });
    const uris = ['spotify:track:1', 'spotify:track:2', 'spotify:track:3'];
    const result = await mutateUrisWithPreservation(client, undefined, 'acct1', uris, 'save');
    expect(result.ok).toBe(true);
    expect(saveBatch).toEqual(uris);
  });

  it('routes to removeUris for remove action', async () => {
    let calledSave = false;
    let calledRemove = false;
    const client = createMockClient({
      saveUris: async () => {
        calledSave = true;
        return true;
      },
      removeUris: async () => {
        calledRemove = true;
        return true;
      },
    });
    const result = await mutateUrisWithPreservation(
      client,
      undefined,
      'acct1',
      ['spotify:album:1'],
      'remove',
    );
    expect(result.ok).toBe(true);
    expect(calledSave).toBe(false);
    expect(calledRemove).toBe(true);
  });

  it('updates cached memberships for affected URIs on save', async () => {
    const cache = new Cache({ filename: ':memory:' });
    const client = createMockClient();
    const uri = 'spotify:track:5';
    await mutateUrisWithPreservation(client, cache, 'acct1', [uri], 'save');
    const cached = cache.getQuery<LibraryMembershipT>('acct1', `membership:v1:${uri}`);
    expect(cached?.payload.state).toBe('saved');
  });

  it('returns ok=false when client throws', async () => {
    const client = createMockClient({
      saveUris: async () => {
        throw new Error('network down');
      },
    });
    const result = await mutateUrisWithPreservation(
      client,
      undefined,
      'acct1',
      ['spotify:track:1'],
      'save',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('coalesces identical concurrent mutations onto one request', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = createMockClient({
      saveUris: async () => {
        calls++;
        await gate;
        return true;
      },
    });
    const uris = ['spotify:track:coalesce'];
    const first = mutateUrisWithPreservation(client, undefined, 'acct1', uris, 'save');
    const second = mutateUrisWithPreservation(client, undefined, 'acct1', uris, 'save');
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('rejects overlapping URIs with a conflicting action while in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = createMockClient({
      saveUris: async () => {
        await gate;
        return true;
      },
    });
    const uris = ['spotify:track:conflict'];
    const first = mutateUrisWithPreservation(client, undefined, 'acct1', uris, 'save');
    const conflict = await mutateUrisWithPreservation(client, undefined, 'acct1', uris, 'remove');
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toContain('IN_FLIGHT');
    release();
    const r1 = await first;
    expect(r1.ok).toBe(true);
  });
});

describe('checkMembershipBatched', () => {
  it('returns empty array for empty URIs', async () => {
    const client = createMockClient();
    const result = await checkMembershipBatched(client, undefined, 'acct1', []);
    expect(result).toEqual([]);
  });

  it('fetches uncached URIs from client and infers kind', async () => {
    const client = createMockClient({
      checkMembership: async (uris) => uris.map(() => true),
    });
    const uris = ['spotify:track:1', 'spotify:album:2'];
    const result = await checkMembershipBatched(client, undefined, 'acct1', uris);
    expect(result.length).toBe(2);
    expect(result[0]?.state).toBe('saved');
    expect(result[0]?.kind).toBe('track');
    expect(result[1]?.kind).toBe('album');
  });

  it('skips client call when all URIs are cached', async () => {
    const cache = new Cache({ filename: ':memory:' });
    const membership: LibraryMembershipT = {
      uri: 'spotify:track:1',
      kind: 'track',
      state: 'saved',
      updatedAt: Date.now(),
    };
    cache.putQuery('acct1', 'membership:v1:spotify:track:1', membership, 60_000);

    let called = false;
    const client = createMockClient({
      checkMembership: async () => {
        called = true;
        return [];
      },
    });

    const result = await checkMembershipBatched(client, cache, 'acct1', ['spotify:track:1']);
    expect(called).toBe(false);
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('saved');
  });

  it('bypasses cache when forceRefresh is true', async () => {
    const cache = new Cache({ filename: ':memory:' });
    const membership: LibraryMembershipT = {
      uri: 'spotify:track:1',
      kind: 'track',
      state: 'saved',
      updatedAt: Date.now(),
    };
    cache.putQuery('acct1', 'membership:v1:spotify:track:1', membership, 60_000);

    let called = false;
    const client = createMockClient({
      checkMembership: async () => {
        called = true;
        return [false];
      },
    });

    const result = await checkMembershipBatched(client, cache, 'acct1', ['spotify:track:1'], true);
    expect(called).toBe(true);
    expect(result[0]?.state).toBe('not_saved');
  });
});
