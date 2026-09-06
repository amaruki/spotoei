import type { CatalogPlaylistT } from 'spotoei-protocol';
import type { Cache } from '../cache';
import { QUOTA_BANNER as BROWSE_QUOTA_BANNER } from '../webApi/transport';
import type { BrowseEndpoints } from '../webApi/browseEndpoints';
type CategoryT = { id: string; name: string; imageUrl?: string };
const PLAYLIST_KEY_PREFIX = 'browse:category:';
const TTL_1H = 60 * 60 * 1000;
const TTL_POISON = 60_000;

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function normalizeLocale(locale: string): string {
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(locale) ? locale : 'en_US';
}

function classifyBrowseError(err: unknown): { code: string; banner: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_QUOTA_EXCEEDED') || msg.includes('QUOTA_EXCEEDED') || /quota/i.test(msg)) {
    return { code: 'QUOTA_EXCEEDED', banner: BROWSE_QUOTA_BANNER };
  }
  if (msg.includes('API_RATE_LIMITED') || msg.includes('RATE_LIMITED') || msg.includes('429')) {
    return { code: 'RATE_LIMITED', banner: 'Rate limited · retry shortly' };
  }
  if (msg.includes('FORBIDDEN') || msg.includes('403')) {
    if (/quota/i.test(msg)) return { code: 'QUOTA_EXCEEDED', banner: BROWSE_QUOTA_BANNER };
    return { code: 'FORBIDDEN', banner: 'Browse unavailable · forbidden' };
  }
  return { code: 'UNKNOWN', banner: 'Browse live unavailable · using offline categories' };
}

export async function getLiveCategories(
  api: BrowseEndpoints,
  cache?: Cache,
  accountId = 'default',
  signal?: AbortSignal,
): Promise<{ categories: CategoryT[]; fallback: boolean; code?: string; banner?: string }> {
  const CATEGORY_LIST_KEY = 'browse:categories';
  if (cache) {
    try {
      const cached = cache.tryGetCached<CategoryT[]>(accountId, CATEGORY_LIST_KEY);
      if (cached) {
        if (!cached.isStale) {
          return { categories: cached.payload, fallback: false };
        }
        const expectedFetchedAt = cached.fetchedAt;
        void (async () => {
          try {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const locale = normalizeLocale('en_US');
            const live = await api.getCategories(locale, 20, 0, signal);
            if (!live || live.length === 0) return;
            if (signal?.aborted) return;
            const cur = cache.tryGetCached<CategoryT[]>(accountId, CATEGORY_LIST_KEY);
            if (!cur) return;
            if (cur.fetchedAt !== expectedFetchedAt) return;
            cache.putQuery(accountId, CATEGORY_LIST_KEY, live, TTL_1H);
          } catch {}
        })();
        return { categories: cached.payload, fallback: false };
      }
    } catch {}
  }
  try {
    const locale = normalizeLocale('en_US');
    const live = await api.getCategories(locale, 20, 0, signal);
    if (!live || live.length === 0) throw new Error('empty');
    if (cache) {
      try {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        cache.putQuery(accountId, CATEGORY_LIST_KEY, live, TTL_1H);
      } catch {}
    }
    return { categories: live, fallback: false };
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;
    const { code, banner } = classifyBrowseError(err);
    return { categories: [], fallback: true, code, banner };
  }
}

export async function getCategoryPlaylistsCached(
  api: BrowseEndpoints,
  cache: Cache,
  accountId: string,
  categoryId: string,
  signalOrOffset?: AbortSignal | number,
  maybeSignal?: AbortSignal,
): Promise<CatalogPlaylistT[]> {
  let offset = 0;
  let signal: AbortSignal | undefined;
  if (typeof signalOrOffset === 'number') {
    offset = Math.max(0, Math.floor(signalOrOffset));
    signal = maybeSignal;
  } else {
    signal = signalOrOffset as AbortSignal | undefined;
  }
  const safeOffset = Math.max(0, Math.floor(offset));
  const encodedId = encodeURIComponent(categoryId);
  const key = `${PLAYLIST_KEY_PREFIX}${encodedId}:playlists:${safeOffset}`;
  if (cache) {
    try {
      const cached = cache.tryGetCached<CatalogPlaylistT[]>(accountId, key);
      if (cached) {
        if (!cached.isStale) return cached.payload;
        const expectedFetchedAt = cached.fetchedAt;
        void (async () => {
          try {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const live = await api.getCategoryPlaylists(categoryId, 20, safeOffset, signal);
            const filtered = live.filter(Boolean);
            if (signal?.aborted) return;
            const cur = cache.tryGetCached<CatalogPlaylistT[]>(accountId, key);
            if (!cur) return;
            if (cur.fetchedAt !== expectedFetchedAt) return;
            const ttl = filtered.length === 0 ? TTL_POISON : TTL_1H;
            cache.putQuery(accountId, key, filtered, ttl);
          } catch {}
        })();
        return cached.payload;
      }
    } catch {}
  }
  const playlists = await api.getCategoryPlaylists(categoryId, 20, safeOffset, signal);
  const filtered = playlists.filter(Boolean);
  if (cache) {
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const ttl = filtered.length === 0 ? TTL_POISON : TTL_1H;
      cache.putQuery(accountId, key, filtered, ttl);
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
    }
  }
  return filtered;
}
