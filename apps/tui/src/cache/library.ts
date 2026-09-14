// Library-index storage and search helpers for the SQLite cache. Extracted
// from cache/index.ts to keep the Cache class module under the 300 LoC cap.

import type { Database } from 'bun:sqlite';

export function escapeLikeWildcards(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function initLibraryIndex(db: Database): void {
  db.exec(`
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

export function indexLibraryItem(
  db: Database,
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

  const stmt = db.prepare(`
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

  const idxStmt = db.prepare(`
      INSERT INTO library_index (account_id, collection, item_id, position, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, collection, item_id) DO UPDATE SET
        position = excluded.position,
        updated_at = excluded.updated_at;
    `);
  idxStmt.run(accountId, collection, id, position ?? null, now);
}

export function indexLibraryItems(
  db: Database,
  accountId: string,
  collection: string,
  items: readonly unknown[],
): void {
  if (!Array.isArray(items) || items.length === 0) return;
  db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      indexLibraryItem(db, accountId, collection, items[i], i);
    }
  })();
}

export function deleteLibraryItem(
  db: Database,
  accountId: string,
  collection: string,
  itemId: string,
): void {
  db.prepare(
    'DELETE FROM cached_library_items WHERE account_id = ? AND collection = ? AND item_id = ?;',
  ).run(accountId, collection, itemId);
  db.prepare(
    'DELETE FROM library_index WHERE account_id = ? AND collection = ? AND item_id = ?;',
  ).run(accountId, collection, itemId);
}

export function searchLibrary<T = unknown>(
  db: Database,
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

  const countRow = db
    .prepare('SELECT COUNT(*) as c FROM cached_library_items WHERE account_id = ?;')
    .get(accountId) as { c?: number } | null;
  if (!countRow || countRow.c === 0) {
    try {
      const rows = db
        .prepare(
          "SELECT query_key, payload_json FROM query_cache WHERE account_id = ? AND query_key LIKE 'library:v1:%';",
        )
        .all(accountId) as Array<{ query_key: string; payload_json: string }>;
      for (const r of rows) {
        const coll = r.query_key.split(':')[2];
        if (coll) {
          const parsed = JSON.parse(r.payload_json);
          if (Array.isArray(parsed?.items)) {
            indexLibraryItems(db, accountId, coll, parsed.items);
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
    const rows = db.prepare(sql).all(...params) as Array<{ payload_json: string }>;
    return rows.map((r) => JSON.parse(r.payload_json) as T);
  }

  const cleanQ = escapeLikeWildcards(q);
  const subPattern = `%${cleanQ}%`;
  const startsPattern = `${cleanQ}%`;
  const chars = q
    .split('')
    .filter((c) => c.trim().length > 0)
    .map(escapeLikeWildcards);
  const fuzzyPattern = chars.length > 0 ? `%${chars.join('%')}%` : '%%';
  const tokens = q.split(/\s+/).filter(Boolean);

  let matchClause: string;
  const matchParams: string[] = [];
  if (tokens.length > 1) {
    const tokenParts = tokens
      .map(
        () =>
          "(name LIKE ? ESCAPE '\\' OR artist_name LIKE ? ESCAPE '\\' OR album_name LIKE ? ESCAPE '\\')",
      )
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
  const rows = db.prepare(sql).all(...params, ...matchParams, ...orderParams) as Array<{
    payload_json: string;
  }>;
  return rows.map((r) => JSON.parse(r.payload_json) as T);
}
