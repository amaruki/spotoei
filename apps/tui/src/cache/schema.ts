// Database open/recovery, integrity check, schema init, version helper.

import { Database } from 'bun:sqlite';
import { renameSync } from 'node:fs';

export function openWithRecovery(filename: string, wal: boolean): Database {
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
          renameSync(filename, `${filename}.corrupt.${Date.now()}`);
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

export function checkIntegrity(db: Database): boolean {
  try {
    const res = db.query('PRAGMA integrity_check;').get() as {
      integrity_check?: string;
    } | null;
    return res?.integrity_check === 'ok';
  } catch {
    return false;
  }
}

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const maxVersionRow = db.query('SELECT MAX(version) as max_v FROM schema_migrations;').get() as {
    max_v?: number;
  } | null;
  if (maxVersionRow && typeof maxVersionRow.max_v === 'number' && maxVersionRow.max_v > 1) {
    throw new Error(`unsupported database schema version: ${maxVersionRow.max_v}`);
  }

  db.exec(`
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
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?);',
  );
  stmt.run(new Date().toISOString());
}

export function getSchemaVersion(db: Database): number {
  const row = db.prepare('SELECT MAX(version) as max_v FROM schema_migrations;').get() as {
    max_v: number | null;
  } | null;
  return row?.max_v ?? 0;
}
