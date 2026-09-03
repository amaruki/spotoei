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

  private filename: string;

  constructor(opts: CacheOptions = {}) {
    this.filename = opts.filename ?? defaultCachePath();
    this.db = this.openWithRecovery(this.filename, opts.wal ?? true);
    this.initSchema();
  }

  private openWithRecovery(filename: string, wal: boolean): Database {
    let db = new Database(filename);
    if (filename !== ':memory:') {
      try {
        const res = db.query('PRAGMA integrity_check;').get() as {
          integrity_check?: string;
        } | null;
        if (!res || res.integrity_check !== 'ok') {
          // Corrupted database: close, remove file, and re-create.
          db.close();
          try {
            const fs = require('node:fs');
            fs.renameSync(filename, `${filename}.corrupt.${Date.now()}`);
          } catch {
            // Ignore file rename error and proceed to fresh database
          }
          db = new Database(filename);
        }
      } catch {
        // If integrity check itself fails, re-create database.
        try {
          db.close();
        } catch {
          // ignore
        }
        db = new Database(filename);
      }

      if (wal) {
        db.exec('PRAGMA journal_mode = WAL;');
      }
    }
    return db;
  }

  checkIntegrity(): boolean {
    try {
      const res = this.db.query('PRAGMA integrity_check;').get() as {
        integrity_check?: string;
      } | null;
      return res?.integrity_check === 'ok';
    } catch {
      return false;
    }
  }
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const maxVersionRow = this.db
      .query('SELECT MAX(version) as max_v FROM schema_migrations;')
      .get() as { max_v?: number } | null;
    if (maxVersionRow && typeof maxVersionRow.max_v === 'number' && maxVersionRow.max_v > 1) {
      throw new Error(`unsupported database schema version: ${maxVersionRow.max_v}`);
    }

    this.db.exec(`
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

    // Record schema version 1 on first init.
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?);',
    );
    stmt.run(new Date().toISOString());
  }
  // --- Migration check helper ---

  getSchemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as max_v FROM schema_migrations;').get() as {
      max_v: number | null;
    } | null;
    return row?.max_v ?? 0;
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
    const stmt = this.db.prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;');
    stmt.run(accountId, queryKey);
  }

  invalidateQueryPrefix(accountId: string, queryKeyPrefix: string): number {
    const stmt = this.db.prepare(
      'DELETE FROM query_cache WHERE account_id = ? AND query_key LIKE ?;',
    );
    const r = stmt.run(accountId, `${queryKeyPrefix}%`);
    return r.changes ?? 0;
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

export function defaultCachePath(): string {
  if (process.env.SPOTOEI_CACHE_FILE) {
    return process.env.SPOTOEI_CACHE_FILE;
  }
  if (process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
    return ':memory:';
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const cacheDir = process.env.XDG_CACHE_HOME ?? `${home}/.cache`;
  const dir = `${cacheDir}/spotoei`;
  try {
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore
  }
  return `${dir}/cache.db`;
}
