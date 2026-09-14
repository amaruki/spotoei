// Entity storage helpers for the SQLite cache. Extracted from cache/index.ts
// to keep the Cache class module under the 300 LoC cap.

import type { Database } from 'bun:sqlite';
import type { CachedEntity } from './types';

export function putEntity<T>(
  db: Database,
  accountId: string,
  entityType: string,
  entityId: string,
  payload: T,
  ttlMs?: number,
): void {
  const now = Date.now();
  const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
  const stmt = db.prepare(`
    INSERT INTO entities (account_id, entity_type, entity_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, entity_type, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at;
  `);
  stmt.run(accountId, entityType, entityId, JSON.stringify(payload), now, expiresAt);
}

export function getEntity<T>(
  db: Database,
  accountId: string,
  entityType: string,
  entityId: string,
): CachedEntity<T> | null {
  const stmt = db.prepare(`
    SELECT account_id, entity_type, entity_id, payload_json, fetched_at, expires_at
    FROM entities
    WHERE account_id = ? AND entity_type = ? AND entity_id = ?;
  `);
  const row = stmt.get(accountId, entityType, entityId) as {
    account_id: string;
    entity_type: string;
    entity_id: string;
    payload_json: string;
    fetched_at: number;
    expires_at: number | null;
  } | null;

  if (!row) return null;

  // TTL pruning on read: drop expired rows immediately
  if (row.expires_at !== null && row.expires_at < Date.now()) {
    db.prepare(
      'DELETE FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?;',
    ).run(accountId, entityType, entityId);
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as T;
    return {
      accountId: row.account_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}
