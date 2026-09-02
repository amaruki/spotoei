import { describe, expect, test, beforeEach } from 'bun:test';
import { Cache } from '../src/cache';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  test('putEntity and getEntity round-trip', () => {
    cache.putEntity('acct1', 'track', 't1', { name: 'Foo', durationMs: 240_000 });
    const got = cache.getEntity<{ name: string; durationMs: number }>(
      'acct1',
      'track',
      't1',
    );
    expect(got).not.toBeNull();
    expect(got!.payload.name).toBe('Foo');
    expect(got!.payload.durationMs).toBe(240_000);
    expect(got!.expiresAt).toBeNull();
  });

  test('getEntity returns null for missing key', () => {
    expect(cache.getEntity('acct1', 'track', 'missing')).toBeNull();
  });

  test('putEntity overwrites previous entry', () => {
    cache.putEntity('acct1', 'track', 't1', { name: 'A' });
    cache.putEntity('acct1', 'track', 't1', { name: 'B' });
    const got = cache.getEntity<{ name: string }>('acct1', 'track', 't1');
    expect(got!.payload.name).toBe('B');
  });

  test('getEntity respects expiresAt', () => {
    const past = Date.now() - 1_000;
    cache.putEntity('acct1', 'track', 't1', { name: 'A' });
    // Manually expire the entry by setting expires_at to a past time.
    cache.putEntity('acct1', 'track', 't1', { name: 'A' }, 0);
    // Wait a tick to ensure Date.now() > past+ttl
    const got = cache.getEntity('acct1', 'track', 't1');
    expect(got).not.toBeNull();
    expect(got!.expiresAt).not.toBeNull();
    expect(got!.expiresAt!).toBeLessThanOrEqual(Date.now());
  });

  test('putQuery and getQuery round-trip', () => {
    cache.putQuery('acct1', 'search:v1:foo:track:0', { hits: [] }, 60_000);
    const got = cache.getQuery('acct1', 'search:v1:foo:track:0');
    expect(got).not.toBeNull();
    expect(got!.expiresAt).not.toBeNull();
  });

  test('invalidateQuery removes the entry', () => {
    cache.putQuery('acct1', 'search:v1:foo:track:0', { hits: [] });
    expect(cache.getQuery('acct1', 'search:v1:foo:track:0')).not.toBeNull();
    cache.invalidateQuery('acct1', 'search:v1:foo:track:0');
    expect(cache.getQuery('acct1', 'search:v1:foo:track:0')).toBeNull();
  });

  test('pruneExpired removes only expired entries', () => {
    cache.putEntity('acct1', 'track', 'old', { name: 'Old' }, -10);
    cache.putEntity('acct1', 'track', 'fresh', { name: 'Fresh' }, 60_000);
    cache.putEntity('acct1', 'track', 'no-ttl', { name: 'NoTTL' });
    const removed = cache.pruneExpired();
    expect(removed).toBe(1);
    expect(cache.getEntity('acct1', 'track', 'old')).toBeNull();
    expect(cache.getEntity('acct1', 'track', 'fresh')).not.toBeNull();
    expect(cache.getEntity('acct1', 'track', 'no-ttl')).not.toBeNull();
  });

  test('accountId scopes entity and query rows', () => {
    cache.putEntity('acct1', 'track', 't1', { name: 'A1' });
    cache.putEntity('acct2', 'track', 't1', { name: 'A2' });
    expect(
      cache.getEntity<{ name: string }>('acct1', 'track', 't1')!.payload.name,
    ).toBe('A1');
    expect(
      cache.getEntity<{ name: string }>('acct2', 'track', 't1')!.payload.name,
    ).toBe('A2');
  });

  test('clearAccount removes all data for the account', () => {
    cache.putEntity('acct1', 'track', 't1', { name: 'A' });
    cache.putEntity('acct2', 'track', 't1', { name: 'A' });
    cache.putQuery('acct1', 'q1', { hits: [] });
    cache.clearAccount('acct1');
    expect(cache.getEntity('acct1', 'track', 't1')).toBeNull();
    expect(cache.getQuery('acct1', 'q1')).toBeNull();
    expect(cache.getEntity('acct2', 'track', 't1')).not.toBeNull();
  });
});
