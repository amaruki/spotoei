// SQLite-backed metadata cache using `bun:sqlite`.
// Caches domain entities and search/query results scoped by `accountId`.
// Secrets are strictly prohibited from entering SQLite.

import { Database } from 'bun:sqlite';
import { checkIntegrity, getSchemaVersion, initSchema, openWithRecovery } from './schema';
import type { CachedEntity, CachedQuery, CacheOptions } from './types';

export type { CachedEntity, CachedQuery, CacheOptions } from './types';

export class Cache {
  private db: Database;
  private filename: string;

  constructor(opts: CacheOptions = {}) {
    this.filename = opts.filename ?? defaultCachePath();
    this.db = openWithRecovery(this.filename, opts.wal ?? true);
    initSchema(this.db);
    try {
      this.pruneExpired();
    } catch {
      // ignore
    }
  }

  checkIntegrity(): boolean {
    return checkIntegrity(this.db);
  }

  getSchemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  // --- Entities ---

  putEntity<T>(
    accountId: string,
    entityType: string,
    entityId: string,
    payload: T,
    ttlMs?: number,
  ): void {
    const now = Date.now();
    const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
    const stmt = this.db.prepare(`
      INSERT INTO entities (account_id, entity_type, entity_id, payload_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, entity_type, entity_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at;
    `);
    stmt.run(accountId, entityType, entityId, JSON.stringify(payload), now, expiresAt);
  }

  getEntity<T>(accountId: string, entityType: string, entityId: string): CachedEntity<T> | null {
    const stmt = this.db.prepare(`
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
      this.db
        .prepare(
          'DELETE FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?;',
        )
        .run(accountId, entityType, entityId);
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

  // --- Queries ---

  putQuery<T>(accountId: string, queryKey: string, payload: T, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
    const stmt = this.db.prepare(`
      INSERT INTO query_cache (account_id, query_key, payload_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, query_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at;
    `);
    stmt.run(accountId, queryKey, JSON.stringify(payload), now, expiresAt);
  }

  getQuery<T>(accountId: string, queryKey: string): CachedQuery<T> | null {
    const stmt = this.db.prepare(`
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
      this.db
        .prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;')
        .run(accountId, queryKey);
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

  // --- Cache invalidation & pruning ---

  invalidateQuery(accountId: string, queryKey: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;',
    );
    stmt.run(accountId, queryKey);
  }

  invalidateQueryPrefix(accountId: string, queryKeyPrefix: string): number {
    const stmt = this.db.prepare(
      'DELETE FROM query_cache WHERE account_id = ? AND query_key LIKE ?;',
    );
    const res = stmt.run(accountId, `${queryKeyPrefix}%`);
    return res.changes;
  }

  pruneExpired(): number {
    const now = Date.now();
    const eStmt = this.db.prepare(
      'DELETE FROM entities WHERE expires_at IS NOT NULL AND expires_at < ?;',
    );
    const eRes = eStmt.run(now);
    const qStmt = this.db.prepare(
      'DELETE FROM query_cache WHERE expires_at IS NOT NULL AND expires_at < ?;',
    );
    const qRes = qStmt.run(now);
    return eRes.changes + qRes.changes;
  }

  clearAccount(accountId: string): void {
    this.db.prepare('DELETE FROM entities WHERE account_id = ?;').run(accountId);
    this.db.prepare('DELETE FROM query_cache WHERE account_id = ?;').run(accountId);
    this.db.prepare('DELETE FROM library_index WHERE account_id = ?;').run(accountId);
  }

  close(): void {
    this.db.close();
  }
}

export function defaultCachePath(): string {
  if (process.env.SPOTOEI_CACHE_FILE) {
    return process.env.SPOTOEI_CACHE_FILE;
  }
  if (process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
    return ':memory:';
  }
  // Cross-platform cache dir lives in config.ts so behavior stays consistent
  // across Linux / macOS / Windows.
  const { getCacheDir } = require('../config') as typeof import('../config');
  const dir = getCacheDir();
  try {
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore
  }
  return `${dir}/cache.db`;
}
