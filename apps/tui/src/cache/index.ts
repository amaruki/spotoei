// SQLite-backed metadata cache using `bun:sqlite`.
// Caches domain entities and search/query results scoped by `accountId`.
// Secrets are strictly prohibited from entering SQLite.
// Storage helpers live in sibling modules; this file wires them into the
// `Cache` class and keeps the public API stable.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { getEntity, putEntity } from './entities';
import {
  deleteLibraryItem,
  indexLibraryItem,
  indexLibraryItems,
  initLibraryIndex,
  searchLibrary,
} from './library';
import {
  clearAccount,
  getQuery,
  invalidateQuery,
  invalidateQueryPrefix,
  pruneExpired,
  putQuery,
} from './queries';
import { checkIntegrity, getSchemaVersion, initSchema, openWithRecovery } from './schema';
import { tryGetCached, tryGetCachedEntity } from './swr';
import type { CachedEntity, CachedQuery, CacheOptions } from './types';
import { getCacheDir } from '../config';

export type { CachedEntity, CachedQuery, CacheOptions } from './types';
export { escapeLikeWildcards } from './library';

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
  tryGetCached<T>(
    accountId: string,
    queryKey: string,
  ): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
    return tryGetCached<T>(this.db, accountId, queryKey);
  }
  tryGetCachedEntity<T>(
    accountId: string,
    entityType: string,
    entityId: string,
  ): { payload: T; isStale: boolean; fetchedAt: number; expiresAt: number | null } | null {
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
    putEntity(this.db, accountId, entityType, entityId, payload, ttlMs);
  }

  getEntity<T>(accountId: string, entityType: string, entityId: string): CachedEntity<T> | null {
    return getEntity<T>(this.db, accountId, entityType, entityId);
  }

  // --- Queries ---

  putQuery<T>(accountId: string, queryKey: string, payload: T, ttlMs?: number): void {
    putQuery(this.db, accountId, queryKey, payload, ttlMs);
  }

  getQuery<T>(accountId: string, queryKey: string): CachedQuery<T> | null {
    return getQuery<T>(this.db, accountId, queryKey);
  }

  // --- Cache invalidation & pruning ---

  invalidateQuery(accountId: string, queryKey: string): void {
    invalidateQuery(this.db, accountId, queryKey);
  }

  invalidateQueryPrefix(accountId: string, queryKeyPrefix: string): number {
    return invalidateQueryPrefix(this.db, accountId, queryKeyPrefix);
  }

  pruneExpired(): number {
    return pruneExpired(this.db);
  }

  clearAccount(accountId: string): void {
    clearAccount(this.db, accountId);
  }

  private initLibraryIndex(): void {
    initLibraryIndex(this.db);
  }

  indexLibraryItem(accountId: string, collection: string, raw: unknown, position?: number): void {
    indexLibraryItem(this.db, accountId, collection, raw, position);
  }

  indexLibraryItems(accountId: string, collection: string, items: readonly unknown[]): void {
    indexLibraryItems(this.db, accountId, collection, items);
  }

  deleteLibraryItem(accountId: string, collection: string, itemId: string): void {
    deleteLibraryItem(this.db, accountId, collection, itemId);
  }

  searchLibrary<T = unknown>(
    accountId: string,
    query: string,
    collections?: string[] | string,
  ): T[] {
    return searchLibrary<T>(this.db, accountId, query, collections);
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
