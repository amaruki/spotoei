// SQLite-backed metadata cache using `bun:sqlite`.
// Caches domain entities and search/query results scoped by `accountId`.
// Secrets are strictly prohibited from entering SQLite.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { checkIntegrity, getSchemaVersion, initSchema, openWithRecovery } from './schema';
import { tryGetCached, tryGetCachedEntity } from './swr';
import type { CachedEntity, CachedQuery, CacheOptions } from './types';
import { getCacheDir } from '../config';

export type { CachedEntity, CachedQuery, CacheOptions } from './types';
export function escapeLikeWildcards(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}


export class Cache {
  private db: Database;
  private filename: string;

  constructor(opts: CacheOptions = {}) {
    this.filename = opts.filename ?? defaultCachePath();
    this.db = openWithRecovery(this.filename, opts.wal ?? true);
    initSchema(this.db);
    this.initLibraryIndex();
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
  tryGetCached<T>(accountId: string, queryKey: string): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
    return tryGetCached<T>(this.db, accountId, queryKey);
  }
  tryGetCachedEntity<T>(accountId: string, entityType: string, entityId: string): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
    return tryGetCachedEntity<T>(this.db, accountId, entityType, entityId);
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
        .prepare('DELETE FROM entities WHERE account_id = ? AND entity_type = ? AND entity_id = ?;')
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

    if (queryKey.startsWith('library:v1:') && payload && typeof payload === 'object') {
      const parts = queryKey.split(':');
      const collection = parts[2];
      const items = (payload as { items?: unknown[] }).items;
      if (collection && Array.isArray(items)) {
        this.indexLibraryItems(accountId, collection, items);
      }
    }
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
    const stmt = this.db.prepare('DELETE FROM query_cache WHERE account_id = ? AND query_key = ?;');
    stmt.run(accountId, queryKey);
  }

  invalidateQueryPrefix(accountId: string, queryKeyPrefix: string): number {
    const stmt = this.db.prepare(
      'DELETE FROM query_cache WHERE account_id = ? AND query_key LIKE ?;',
    );
    const res = stmt.run(accountId, `${queryKeyPrefix}%`);
    if (queryKeyPrefix.startsWith('library:v1:')) {
      const parts = queryKeyPrefix.split(':');
      const coll = parts[2];
      if (coll) {
        this.db
          .prepare('DELETE FROM cached_library_items WHERE account_id = ? AND collection = ?;')
          .run(accountId, coll);
        this.db
          .prepare('DELETE FROM library_index WHERE account_id = ? AND collection = ?;')
          .run(accountId, coll);
      }
    }
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
    this.db.prepare('DELETE FROM cached_library_items WHERE account_id = ?;').run(accountId);
  }

  private initLibraryIndex(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cached_library_items (
        account_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        artist_name TEXT,
        album_name TEXT,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, collection, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cached_library_items_search
        ON cached_library_items (account_id, collection, name, artist_name);
    `);
  }

  indexLibraryItem(
    accountId: string,
    collection: string,
    raw: unknown,
    position?: number,
  ): void {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    const uri = typeof item.uri === 'string' ? item.uri : '';
    const id = String(item.id || (uri ? uri.split(':').pop() : '') || '');
    if (!id) return;
    const name = String(item.name || '');

    let artistName = '';
    if (Array.isArray(item.artists) && item.artists.length > 0) {
      artistName = item.artists
        .map((a: unknown) => {
          if (typeof a === 'string') return a;
          if (a && typeof a === 'object' && 'name' in a) {
            return String((a as { name?: unknown }).name ?? '');
          }
          return '';
        })
        .filter(Boolean)
        .join(', ');
    } else if (typeof item.artist === 'string') {
      artistName = item.artist;
    } else if (item.owner && typeof item.owner === 'object') {
      artistName = String(
        (item.owner as { displayName?: unknown; id?: unknown }).displayName ??
          (item.owner as { id?: unknown }).id ??
          '',
      );
    } else if (typeof item.publisher === 'string') {
      artistName = item.publisher;
    }

    let albumName = '';
    if (typeof item.albumName === 'string') {
      albumName = item.albumName;
    } else if (item.album && typeof item.album === 'object') {
      albumName = String((item.album as { name?: unknown }).name ?? '');
    }

    const now = Date.now();
    const payloadJson = JSON.stringify(item);

    const stmt = this.db.prepare(`
      INSERT INTO cached_library_items (account_id, collection, item_id, name, artist_name, album_name, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, collection, item_id) DO UPDATE SET
        name = excluded.name,
        artist_name = excluded.artist_name,
        album_name = excluded.album_name,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at;
    `);
    stmt.run(accountId, collection, id, name, artistName, albumName, payloadJson, now);

    const idxStmt = this.db.prepare(`
      INSERT INTO library_index (account_id, collection, item_id, position, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, collection, item_id) DO UPDATE SET
        position = excluded.position,
        updated_at = excluded.updated_at;
    `);
    idxStmt.run(accountId, collection, id, position ?? null, now);
  }

  indexLibraryItems(accountId: string, collection: string, items: readonly unknown[]): void {
    if (!Array.isArray(items) || items.length === 0) return;
    this.db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        this.indexLibraryItem(accountId, collection, items[i], i);
      }
    })();
  }

  deleteLibraryItem(accountId: string, collection: string, itemId: string): void {
    this.db
      .prepare('DELETE FROM cached_library_items WHERE account_id = ? AND collection = ? AND item_id = ?;')
      .run(accountId, collection, itemId);
    this.db
      .prepare('DELETE FROM library_index WHERE account_id = ? AND collection = ? AND item_id = ?;')
      .run(accountId, collection, itemId);
  }

  searchLibrary<T = unknown>(
    accountId: string,
    query: string,
    collections?: string[] | string,
  ): T[] {
    const q = query.trim();
    const colList =
      typeof collections === 'string'
        ? [collections]
        : Array.isArray(collections) && collections.length > 0
          ? collections
          : null;

    const countRow = this.db
      .prepare('SELECT COUNT(*) as c FROM cached_library_items WHERE account_id = ?;')
      .get(accountId) as { c?: number } | null;
    if (!countRow || countRow.c === 0) {
      try {
        const rows = this.db
          .prepare(
            "SELECT query_key, payload_json FROM query_cache WHERE account_id = ? AND query_key LIKE 'library:v1:%';",
          )
          .all(accountId) as Array<{ query_key: string; payload_json: string }>;
        for (const r of rows) {
          const coll = r.query_key.split(':')[2];
          if (coll) {
            const parsed = JSON.parse(r.payload_json);
            if (Array.isArray(parsed?.items)) {
              this.indexLibraryItems(accountId, coll, parsed.items);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (!q) {
      let sql = 'SELECT payload_json FROM cached_library_items WHERE account_id = ?';
      const params: string[] = [accountId];
      if (colList && colList.length > 0) {
        sql += ` AND collection IN (${colList.map(() => '?').join(', ')})`;
        params.push(...colList);
      }
      sql += ' ORDER BY updated_at DESC;';
      const rows = this.db.prepare(sql).all(...params) as Array<{ payload_json: string }>;
      return rows.map((r) => JSON.parse(r.payload_json) as T);
    }

    const cleanQ = escapeLikeWildcards(q);
    const subPattern = `%${cleanQ}%`;
    const startsPattern = `${cleanQ}%`;
    const chars = q.split('').filter((c) => c.trim().length > 0).map(escapeLikeWildcards);
    const fuzzyPattern = chars.length > 0 ? `%${chars.join('%')}%` : '%%';
    const tokens = q.split(/\s+/).filter(Boolean);

    let matchClause: string;
    const matchParams: string[] = [];
    if (tokens.length > 1) {
      const tokenParts = tokens
        .map(() => "(name LIKE ? ESCAPE '\\' OR artist_name LIKE ? ESCAPE '\\' OR album_name LIKE ? ESCAPE '\\')")
        .join(' AND ');
      matchClause = `(${tokenParts}) OR (name LIKE ? ESCAPE '\\' OR artist_name LIKE ? ESCAPE '\\')`;
      for (const t of tokens) {
        const tp = `%${escapeLikeWildcards(t)}%`;
        matchParams.push(tp, tp, tp);
      }
      matchParams.push(fuzzyPattern, fuzzyPattern);
    } else {
      matchClause =
        "(name LIKE ? ESCAPE '\\' OR artist_name LIKE ? ESCAPE '\\' OR album_name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR artist_name LIKE ? ESCAPE '\\')";
      matchParams.push(subPattern, subPattern, subPattern, fuzzyPattern, fuzzyPattern);
    }

    let sql = `SELECT payload_json FROM cached_library_items WHERE account_id = ?`;
    const params: string[] = [accountId];
    if (colList && colList.length > 0) {
      sql += ` AND collection IN (${colList.map(() => '?').join(', ')})`;
      params.push(...colList);
    }
    sql += ` AND (${matchClause})`;

    const orderParams = [q, startsPattern, subPattern, subPattern, fuzzyPattern];
    sql += `
      ORDER BY
        CASE
          WHEN LOWER(name) = LOWER(?) THEN 1
          WHEN name LIKE ? ESCAPE '\\' THEN 2
          WHEN name LIKE ? ESCAPE '\\' THEN 3
          WHEN artist_name LIKE ? ESCAPE '\\' THEN 4
          WHEN name LIKE ? ESCAPE '\\' THEN 5
          ELSE 6
        END ASC,
        updated_at DESC;
    `;
    const rows = this.db.prepare(sql).all(...params, ...matchParams, ...orderParams) as Array<{
      payload_json: string;
    }>;
    return rows.map((r) => JSON.parse(r.payload_json) as T);
  }

  searchCachedLibrary<T = unknown>(
    accountId: string,
    query: string,
    collections?: string[] | string,
  ): T[] {
    return this.searchLibrary<T>(accountId, query, collections);
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
  const dir = getCacheDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore
  }
  return `${dir}/cache.db`;
}
