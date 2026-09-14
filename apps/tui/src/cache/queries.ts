// Query-cache storage and invalidation helpers for the SQLite cache.
// Extracted from cache/index.ts to keep the Cache class module under the
// 300 LoC cap.

import type { Database } from 'bun:sqlite';
import { indexLibraryItems } from './library';
import type { CachedQuery } from './types';

export function putQuery<T>(
  db: Database,
  accountId: string,
  queryKey: string,
  payload: T,
  ttlMs?: number,
): void {
  const now = Date.now();
  const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
  const stmt = db.prepare(`
    INSERT INTO query_cache (account_id, query_key, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, query_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at;
  `);
  stmt.run(accountId, queryKey, JSON.stringify(payload), now, expiresAt);

  if (queryKey.startsWith('library:v1:') && payload && typeof payload === 'object') {
    const parts = queryKey.split(':');
    const collection = parts[2];
    const items = (payload as { items?: unknown[] }).items;
    if (collection && Array.isArray(items)) {
      indexLibraryItems(db, accountId, collection, items);
    }
  }
}

export function getQuery<T>(
  db: Database,
  accountId: string,
  queryKey: string,
): CachedQuery<T> | null {
  const stmt = db.prepare(`
    SELECT account_id, query_key, payload_json, fetched_at, expires_at
    FROM query_cache
    WHERE account_id = ? AND query_key = ?;
  `);
  const row = stmt.get(accountId, queryKey) as {
    account_id: string;
    query_key: string;
    payload_json: string;
    fetched_at: number;
    expires_at: number | null;
  } | null;

  if (!row) return null;

  // TTL pruning on read: drop expired rows immediately
  if (row.expires_at !== null && row.expires_at < Date.now()) {
    db.prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;').run(
      accountId,
      queryKey,
    );
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as T;
    return {
      accountId: row.account_id,
      queryKey: row.query_key,
      payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}

export function invalidateQuery(db: Database, accountId: string, queryKey: string): void {
  const stmt = db.prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;');
  stmt.run(accountId, queryKey);
}

export function invalidateQueryPrefix(
  db: Database,
  accountId: string,
  queryKeyPrefix: string,
): number {
  const stmt = db.prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key LIKE ?;');
  const res = stmt.run(accountId, `${queryKeyPrefix}%`);
  if (queryKeyPrefix.startsWith('library:v1:')) {
    const parts = queryKeyPrefix.split(':');
    const coll = parts[2];
    if (coll) {
      db.prepare('DELETE FROM cached_library_items WHERE account_id = ? AND collection = ?;').run(
        accountId,
        coll,
      );
      db.prepare('DELETE FROM library_index WHERE account_id = ? AND collection = ?;').run(
        accountId,
        coll,
      );
    }
  }
  return res.changes;
}

export function pruneExpired(db: Database): number {
  const now = Date.now();
  const eStmt = db.prepare('DELETE FROM entities WHERE expires_at IS NOT NULL AND expires_at < ?;');
  const eRes = eStmt.run(now);
  const qStmt = db.prepare(
    'DELETE FROM query_cache WHERE expires_at IS NOT NULL AND expires_at < ?;',
  );
  const qRes = qStmt.run(now);
  return eRes.changes + qRes.changes;
}

export function clearAccount(db: Database, accountId: string): void {
  db.prepare('DELETE FROM entities WHERE account_id = ?;').run(accountId);
  db.prepare('DELETE FROM query_cache WHERE account_id = ?;').run(accountId);
  db.prepare('DELETE FROM library_index WHERE account_id = ?;').run(accountId);
  db.prepare('DELETE FROM cached_library_items WHERE account_id = ?;').run(accountId);
}
