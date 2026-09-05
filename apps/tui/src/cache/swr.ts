// SWR helpers extracted for 300 LoC cap.
import type { Database } from 'bun:sqlite';

export function tryGetCached<T>(
  db: Database,
  accountId: string,
  queryKey: string,
): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
  const row = db
    .prepare(
      'SELECT payload_json, fetched_at, expires_at FROM query_cache WHERE account_id = ? AND query_key = ?;',
    )
    .get(accountId, queryKey) as
    | { payload_json: string; fetched_at: number; expires_at: number | null }
    | null;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as T;
    const isStale = row.expires_at !== null && row.expires_at < Date.now();
    return { payload, isStale, fetchedAt: row.fetched_at, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}

export function tryGetCachedEntity<T>(
  db: Database,
  accountId: string,
  entityType: string,
  entityId: string,
): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
  const row = db
    .prepare(
      'SELECT payload_json, fetched_at, expires_at FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?;',
    )
    .get(accountId, entityType, entityId) as
    | { payload_json: string; fetched_at: number; expires_at: number | null }
    | null;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as T;
    const isStale = row.expires_at !== null && row.expires_at < Date.now();
    return { payload, isStale, fetchedAt: row.fetched_at, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}
