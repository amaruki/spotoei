import { describe, expect, test, beforeEach } from 'bun:test';
import { Cache } from '../src/cache';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  test('putEntity and getEntity round-trip', () => {
    cache.putEntity('acct1', 'track', 't1', { name: 'Foo', durationMs: 240_000 });
    const got = cache.getEntity<{ name: string; durationMs: number }>('acct1', 'track', 't1');
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
    // Manually expire the entry by setting expires_at to a past time.
    cache.putEntity('acct1', 'track', 't1', { name: 'A' });
    // Manually expire the entry by setting expires_at to a past time.
    cache.putEntity('acct1', 'track', 't1', { name: 'A' }, -1);
    // Wait a tick to ensure Date.now() > past+ttl
    const got = cache.getEntity('acct1', 'track', 't1');
    expect(got).toBeNull();
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
    expect(cache.getEntity<{ name: string }>('acct1', 'track', 't1')!.payload.name).toBe('A1');
    expect(cache.getEntity<{ name: string }>('acct2', 'track', 't1')!.payload.name).toBe('A2');
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

  test('searchLibrary performs substring and fuzzy search on indexed items', () => {
    cache.indexLibraryItems('acct1', 'saved_tracks', [
      {
        id: 't1',
        name: 'Bohemian Rhapsody',
        artists: [{ name: 'Queen' }],
        albumName: 'A Night at the Opera',
      },
      { id: 't2', name: 'Radio Ga Ga', artists: [{ name: 'Queen' }], albumName: 'The Works' },
      { id: 't3', name: 'Creep', artists: [{ name: 'Radiohead' }], albumName: 'Pablo Honey' },
    ]);
    cache.indexLibraryItems('acct1', 'saved_albums', [
      { id: 'al1', name: 'OK Computer', artists: [{ name: 'Radiohead' }] },
    ]);
    cache.indexLibraryItems('acct1', 'playlists', [{ id: 'p1', name: 'Queen Essentials' }]);

    // Substring match on track title
    const r1 = cache.searchLibrary<{ id: string; name: string }>('acct1', 'bohemian');
    expect(r1.length).toBe(1);
    expect(r1[0]?.name).toBe('Bohemian Rhapsody');

    // Substring match on artist
    const r2 = cache.searchLibrary<{ id: string; name: string }>('acct1', 'radiohead');
    expect(r2.map((x) => x.name)).toEqual(['OK Computer', 'Creep']);

    // Substring match filtered by collection
    const r3 = cache.searchLibrary<{ id: string; name: string }>('acct1', 'queen', 'saved_tracks');
    expect(new Set(r3.map((x) => x.name))).toEqual(new Set(['Radio Ga Ga', 'Bohemian Rhapsody']));

    // Multi-token match across name, artist, and album
    const r4 = cache.searchLibrary<{ id: string; name: string }>('acct1', 'queen opera');
    expect(r4.length).toBe(1);
    expect(r4[0]?.name).toBe('Bohemian Rhapsody');

    // Fuzzy search (bhm -> Bohemian)
    const r5 = cache.searchLibrary<{ id: string; name: string }>('acct1', 'bhm');
    expect(r5.length).toBe(1);
    expect(r5[0]?.name).toBe('Bohemian Rhapsody');

    // Empty query returns all items
    const all = cache.searchLibrary('acct1', '');
    expect(all.length).toBe(5);

    // searchCachedLibrary alias works identically
    const aliasResult = cache.searchCachedLibrary<{ id: string; name: string }>(
      'acct1',
      'bohemian',
    );
    expect(aliasResult.length).toBe(1);
    expect(aliasResult[0]?.name).toBe('Bohemian Rhapsody');
  });

  test('putQuery with library key automatically indexes items', () => {
    cache.putQuery('acct1', 'library:v1:saved_tracks:0:20', {
      collection: 'saved_tracks',
      items: [
        {
          id: 't10',
          name: 'Under Pressure',
          artists: [{ name: 'Queen' }, { name: 'David Bowie' }],
        },
      ],
    });

    const res = cache.searchLibrary<{ id: string; name: string }>('acct1', 'bowie');
    expect(res.length).toBe(1);
    expect(res[0]?.name).toBe('Under Pressure');
  });

  test('deleteLibraryItem and invalidateQueryPrefix remove indexed items', () => {
    cache.indexLibraryItems('acct1', 'saved_tracks', [
      { id: 't1', name: 'Song One' },
      { id: 't2', name: 'Song Two' },
    ]);
    expect(cache.searchLibrary('acct1', 'Song').length).toBe(2);

    cache.deleteLibraryItem('acct1', 'saved_tracks', 't1');
    expect(cache.searchLibrary('acct1', 'Song').length).toBe(1);

    cache.invalidateQueryPrefix('acct1', 'library:v1:saved_tracks');
    expect(cache.searchLibrary('acct1', 'Song').length).toBe(0);
  });
  test('getSchemaVersion returns 1 after init', () => {
    expect(cache.getSchemaVersion()).toBe(1);
  });

  test('getSchemaVersion is idempotent across reopens', () => {
    cache.close();
    const reopened = new Cache();
    expect(reopened.getSchemaVersion()).toBe(1);
    reopened.close();
  });

  test('checkIntegrity returns true on healthy database', () => {
    expect(cache.checkIntegrity()).toBe(true);
  });

  test('recovers automatically from a corrupted database file', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotoei-corrupt-test-'));
    const dbPath = path.join(tmpDir, 'cache.db');

    // Create valid DB
    const c1 = new Cache({ filename: dbPath });
    c1.putEntity('user1', 'track', 't1', { name: 'Valid' });
    c1.close();

    // Corrupt the DB file by writing random bytes
    fs.writeFileSync(dbPath, 'corrupted data garbage payload');

    // Open should detect corruption, back up the corrupt file, and create a fresh DB
    const c2 = new Cache({ filename: dbPath });
    expect(c2.checkIntegrity()).toBe(true);
    expect(c2.getSchemaVersion()).toBe(1);
    c2.close();

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("searchLibrary safely escapes %, _, \\, and ' in SQL LIKE queries", () => {
    cache.indexLibraryItems('acct1', 'saved_tracks', [
      {
        id: 't1',
        name: '100% Hits',
        artists: [{ name: "Rock 'n' Rollers" }],
        albumName: 'Album A',
      },
      { id: 't2', name: '1000 Hits', artists: [{ name: 'Pop Stars' }], albumName: 'Album B' },
      {
        id: 't3',
        name: "Don't Stop Believin'",
        artists: [{ name: 'Journey' }],
        albumName: 'Escape',
      },
      { id: 't4', name: 'Track_Special', artists: [{ name: 'Artist C' }], albumName: 'Album C' },
      { id: 't5', name: 'Track Special', artists: [{ name: 'Artist D' }], albumName: 'Album D' },
    ]);

    // Query with %: matches only literal %
    const rPct = cache.searchLibrary<{ id: string; name: string }>('acct1', '100%');
    expect(rPct.length).toBe(1);
    expect(rPct[0]?.name).toBe('100% Hits');

    // Query with bare %: matches only items with literal %
    const rBarePct = cache.searchLibrary<{ id: string; name: string }>('acct1', '%');
    expect(rBarePct.length).toBe(1);
    expect(rBarePct[0]?.name).toBe('100% Hits');

    // Query with single quote: safely searches for ' without SQL syntax error or injection
    const rQuote = cache.searchLibrary<{ id: string; name: string }>('acct1', "Don't");
    expect(rQuote.length).toBe(1);
    expect(rQuote[0]?.name).toBe("Don't Stop Believin'");

    const rBareQuote = cache.searchLibrary<{ id: string; name: string }>('acct1', "'");
    expect(new Set(rBareQuote.map((x) => x.name))).toEqual(
      new Set(['100% Hits', "Don't Stop Believin'"]),
    );

    // Query combining % and ':
    const rCombined = cache.searchLibrary<{ id: string; name: string }>('acct1', "100% 'n'");
    expect(rCombined.length).toBe(1);
    expect(rCombined[0]?.name).toBe('100% Hits');

    // Query with SQL injection attempt:
    const rSqlInj = cache.searchLibrary<{ id: string; name: string }>('acct1', "' OR '1'='1");
    expect(rSqlInj.length).toBe(0);

    // Query with _: matches literal underscore only, not wildcard
    const rUnderscore = cache.searchLibrary<{ id: string; name: string }>('acct1', 'Track_Special');
    expect(rUnderscore.length).toBe(1);
    expect(rUnderscore[0]?.name).toBe('Track_Special');

    // Alias searchCachedLibrary also works with % and '
    const rCached = cache.searchCachedLibrary<{ id: string; name: string }>('acct1', '100%');
    expect(rCached.length).toBe(1);
    expect(rCached[0]?.name).toBe('100% Hits');
  });
});
