// SQLite-backed metadata cache using `bun:sqlite`.
// Caches domain entities and search/query results scoped by `accountId`.
// Secrets are strictly prohibited from entering SQLite.

import { Database } from 'bun:sqlite';

export interface CacheOptions {
  filename?: string;
  wal?: boolean;
}

export interface CachedEntity<T = unknown> {
  accountId: string;
  entityType: string;
  entityId: string;
  payload: T;
  fetchedAt: number;
  expiresAt: number | null;
}

export interface CachedQuery<T = unknown> {
  accountId: string;
  queryKey: string;
  payload: T;
  fetchedAt: number;
  expiresAt: number | null;
}

export class Cache {
  private db: Database;

  constructor(opts: CacheOptions = {}) {
    const filename = opts.filename ?? ':memory:';
    this.db = new Database(filename);
    if (opts.wal ?? true) {
      if (filename !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        account_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (account_id, entity_type, entity_id)
      );

      CREATE TABLE IF NOT EXISTS query_cache (
        account_id TEXT NOT NULL,
        query_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (account_id, query_key)
      );

      CREATE TABLE IF NOT EXISTS library_index (
        account_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        item_id TEXT NOT NULL,
        position INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, collection, item_id)
      );
    `);
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
    stmt.run(
      accountId,
      entityType,
      entityId,
      JSON.stringify(payload),
      now,
      expiresAt,
    );
  }

  getEntity<T>(
    accountId: string,
    entityType: string,
    entityId: string,
  ): CachedEntity<T> | null {
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

  putQuery<T>(
    accountId: string,
    queryKey: string,
    payload: T,
    ttlMs?: number,
  ): void {
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

  pruneExpired(): number {
    const now = Date.now();
    const stmt1 = this.db.prepare(
      'DELETE FROM entities WHERE expires_at IS NOT NULL AND expires_at < ?;',
    );
    const r1 = stmt1.run(now);
    const stmt2 = this.db.prepare(
      'DELETE FROM query_cache WHERE expires_at IS NOT NULL AND expires_at < ?;',
    );
    const r2 = stmt2.run(now);
    return (r1.changes ?? 0) + (r2.changes ?? 0);
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
