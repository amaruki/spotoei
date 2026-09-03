// Shared types and interfaces for the SQLite cache.

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
