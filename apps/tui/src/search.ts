// Search client with debounce + cancellation, plus a stale-while-revalidate
// read strategy through the SQLite cache. Cancellation is race-safe: a stale
// response is silently dropped and never overwrites a newer one.

import { Cache } from './cache';
import { WebApiClient } from './webApi';
import type { SearchResponseT } from 'spotoei-protocol';

export interface SearchClientOptions {
  webApi: WebApiClient;
  cache: Cache;
  accountId: string;
  debounceMs?: number;
  cacheTtlMs?: number;
}

export interface SearchClient {
  search(
    query: string,
    types?: Array<'track' | 'album' | 'artist' | 'playlist'>,
  ): Promise<SearchResponseT>;
  close(): void;
}

function makeKey(query: string, types: readonly string[]): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return `search:v1:${normalized}:${types.join(',')}`;
}

export function createSearchClient(opts: SearchClientOptions): SearchClient {
  const debounceMs = opts.debounceMs ?? 300;
  const cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;

  let pendingQueryId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentQuery: string | null = null;
  let currentTypes: Array<'track' | 'album' | 'artist' | 'playlist'> = ['track'];
  let resolvers: Array<(r: SearchResponseT) => void> = [];

  const flush = async (): Promise<void> => {
    if (currentQuery === null) return;
    const myId = ++pendingQueryId;
    const query = currentQuery;
    const types = currentTypes.slice();
    const cacheKey = makeKey(query, types);

    // Cache lookup
    const cached = opts.cache.getQuery<SearchResponseT>(opts.accountId, cacheKey);
    if (cached) {
      const expired =
        cached.expiresAt !== null && cached.expiresAt < Date.now();
      if (!expired) {
        if (myId === pendingQueryId) {
          const waiters = resolvers;
          resolvers = [];
          for (const r of waiters) r(cached.payload);
        }
        return;
      }
    }

    // Fetch fresh
    try {
      const fresh = await opts.webApi.search(query, types);
      if (myId === pendingQueryId) {
        opts.cache.putQuery(opts.accountId, cacheKey, fresh, cacheTtlMs);
        const waiters = resolvers;
        resolvers = [];
        for (const r of waiters) r(fresh);
      }
      // If myId < pendingQueryId, a newer query has been issued; drop this result.
    } catch (err: unknown) {
      if (myId === pendingQueryId) {
        const waiters = resolvers;
        resolvers = [];
        for (const r of waiters) {
          r({
            query,
            hits: [],
            error: {
              code: 'NETWORK_ERROR',
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            },
          });
        }
      }
    }
  };

  return {
    async search(
      query: string,
      types: Array<'track' | 'album' | 'artist' | 'playlist'> = ['track'],
    ): Promise<SearchResponseT> {
      const trimmed = query.trim();
      if (!trimmed) {
        return { query, hits: [] };
      }

      // Cancel any pending debounce
      if (timer !== null) {
        clearTimeout(timer);
      }

      currentQuery = trimmed;
      currentTypes = types;
      // Bump pendingQueryId immediately to invalidate any in-flight flush
      // from a previous query.
      pendingQueryId++;

      return new Promise<SearchResponseT>((resolve) => {
        resolvers.push(resolve);
        timer = setTimeout(() => {
          timer = null;
          void flush();
        }, debounceMs);
      });
    },
    close(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      currentQuery = null;
      resolvers = [];
    },
  };
}
