// Search client with debounce + cancellation, plus a stale-while-revalidate
// read strategy through the SQLite cache. Cancellation is race-safe: a stale
// query's promise resolves with an empty response or is replaced cleanly
// without cross-query resolver pollution. AbortController aborts stale
// network fetches so the server does not waste quota.

import { Cache } from './cache';
import { WebApiClient } from './webApi';
import type { SearchResponseT } from 'spotoei-protocol';
import { filterLibraryLocal, setDefaultClientState } from './searchFilters';

export {
  filterItemsInMemory,
  filterLibraryLocal,
  isFuzzyMatch,
  itemToSearchHit,
} from './searchFilters';
export interface SearchClientOptions {
  webApi: WebApiClient;
  cache: Cache;
  accountId: string;
  debounceMs?: number;
  cacheTtlMs?: number;
}

export type SearchType = 'track' | 'album' | 'artist' | 'playlist' | 'show' | 'episode';

export interface SearchClient {
  search(query: string, types?: SearchType[]): Promise<SearchResponseT>;
  filterLibraryLocal<T = unknown>(
    query: string,
    collections?: string[] | string,
  ): T[] & SearchResponseT;
  close(): void;
  setAccountId(accountId: string): void;
}

function makeKey(query: string, types: readonly string[]): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return `search:v1:${normalized}:${types.join(',')}`;
}

interface PendingQuery {
  id: number;
  query: string;
  types: SearchType[];
  resolve: (r: SearchResponseT) => void;
}

export function createSearchClient(opts: SearchClientOptions): SearchClient {
  const debounceMs = opts.debounceMs ?? 300;
  const cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;
  setDefaultClientState({ cache: opts.cache, accountId: opts.accountId });

  let querySequence = 0;
  let activeQueryId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PendingQuery | null = null;
  let abortCtrl: AbortController | null = null;
  let accountId = opts.accountId;

  const flush = async (pq: PendingQuery): Promise<void> => {
    if (pq.id < activeQueryId) {
      pq.resolve({ query: pq.query, hits: [] });
      return;
    }

    const cacheKey = makeKey(pq.query, pq.types);

    const cached = opts.cache.getQuery<SearchResponseT>(accountId, cacheKey);
    if (cached) {
      const expired = cached.expiresAt !== null && cached.expiresAt < Date.now();
      if (!expired) {
        if (pq.id === activeQueryId) {
          pq.resolve({ ...cached.payload, query: pq.query });
        } else {
          pq.resolve({ query: pq.query, hits: [] });
        }
        return;
      }
    }

    abortCtrl?.abort();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;

    try {
      const fresh = await opts.webApi.search(pq.query, pq.types, 10, signal);
      if (signal.aborted || pq.id < activeQueryId) {
        pq.resolve({ query: pq.query, hits: [] });
        return;
      }
      if (pq.id === activeQueryId) {
        if (!fresh.error) {
          opts.cache.putQuery(accountId, cacheKey, fresh, cacheTtlMs);
        }
        pq.resolve(fresh);
      } else {
        pq.resolve({ query: pq.query, hits: [] });
      }
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        pq.resolve({ query: pq.query, hits: [] });
        return;
      }
      if (pq.id === activeQueryId) {
        pq.resolve({
          query: pq.query,
          hits: [],
          error: {
            code: 'NETWORK_ERROR',
            message: err instanceof Error ? err.message : String(err),
            retryable: true,
          },
        });
      } else {
        pq.resolve({ query: pq.query, hits: [] });
      }
    } finally {
      if (abortCtrl?.signal === signal) abortCtrl = null;
    }
  };

  return {
    async search(
      query: string,
      types: SearchType[] = ['track', 'album', 'artist', 'playlist', 'show', 'episode'],
    ): Promise<SearchResponseT> {
      const trimmed = query.trim();
      if (!trimmed) {
        return { query: trimmed, hits: [] };
      }

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null) {
        const superseded = pending;
        pending = null;
        superseded.resolve({ query: superseded.query, hits: [] });
      }
      abortCtrl?.abort();

      const id = ++querySequence;
      activeQueryId = id;

      return new Promise<SearchResponseT>((resolve) => {
        const pq: PendingQuery = {
          id,
          query: trimmed,
          types: types.slice(),
          resolve,
        };
        pending = pq;

        timer = setTimeout(() => {
          timer = null;
          pending = null;
          void flush(pq);
        }, debounceMs);
      });
    },
    close(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null) {
        const superseded = pending;
        pending = null;
        superseded.resolve({ query: superseded.query, hits: [] });
      }
      abortCtrl?.abort();
      abortCtrl = null;
    },
    filterLibraryLocal<T = unknown>(query: string, collections?: string[] | string) {
      return filterLibraryLocal<T>(query, opts.cache, accountId, collections);
    },
    setAccountId(nextAccountId: string): void {
      if (accountId === nextAccountId) return;
      accountId = nextAccountId;
      setDefaultClientState({ cache: opts.cache, accountId });
      querySequence++;
      activeQueryId = querySequence;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null) {
        pending.resolve({ query: pending.query, hits: [] });
        pending = null;
      }
      abortCtrl?.abort();
    },
  };
}
