// Transport layer for Spotify Web API HTTP communication.
// Handles auth token resolution, in-flight request deduplication,
// 401 token refresh retries, and 429 rate limit backoff.

import { diagnostic, reportFailure } from '../diagnostics';
import { ApiError } from './transportErrors';
import { doFetchRequest, type FetchContext } from './transportFetch';
import {
  isDeprecatedEndpoint,
  RATE_LIMIT_TTL_MS,
  RESTRICTION_TTL_MS,
  type RestrictionStore,
} from './transportRestrictions';
import { mergeTokenRefresh } from './transportTokens';
import type { HttpMethod, TokenPayload, TokenProvider } from './types';

export {
  QUOTA_BANNER,
  BROWSE_QUOTA_BANNER,
  SEARCH_QUOTA_BANNER,
  ApiError,
  parseRetryAfterMs,
} from './transportErrors';
export { preserveRefreshToken, mergeTokenRefresh } from './transportTokens';
export { isDeprecatedEndpoint, type RestrictionStore } from './transportRestrictions';

export class Transport {
  private tokenProvider: TokenProvider;
  private baseUrl: string;
  private inFlight = new Map<string, Promise<unknown>>();
  // Endpoints recently refused with 403/404 as a platform restriction
  // (pathname -> timestamp when the restriction entry expires).
  private restrictedUntil = new Map<string, number>();
  private restrictionStore?: RestrictionStore;
  private rateLimitedUntil = new Map<string, number>();
  private responseCache = new Map<string, unknown>();
  private currentRefreshToken?: string;
  constructor(
    tokenProvider: TokenProvider,
    baseUrl = 'https://api.spotify.com/v1',
    restrictionStore?: RestrictionStore,
  ) {
    this.tokenProvider = tokenProvider;
    this.baseUrl = baseUrl;
    this.restrictionStore = restrictionStore;
  }

  setRefreshToken(token: string | null | undefined): void {
    if (typeof token === 'string' && token.trim().length > 0) {
      this.currentRefreshToken = token;
      this.tokenProvider.setRefreshToken?.(token);
    }
  }

  getRefreshToken(): string | undefined {
    return this.currentRefreshToken ?? this.tokenProvider.getRefreshToken?.();
  }

  handleTokenRefresh<T extends TokenPayload>(refreshed: T): T {
    const prev = this.getRefreshToken();
    const merged = mergeTokenRefresh(prev, refreshed);
    const preserved = merged.refresh_token ?? merged.refreshToken;
    if (typeof preserved === 'string' && preserved.trim().length > 0) {
      this.setRefreshToken(preserved);
    }
    return merged;
  }

  private isRestricted(endpoint: string): boolean {
    const now = Date.now();
    const mem = this.restrictedUntil.get(endpoint);
    if (mem !== undefined) {
      if (now < mem) return true;
      this.restrictedUntil.delete(endpoint);
    }
    try {
      const stored = this.restrictionStore?.getRestriction(endpoint);
      if (stored !== undefined && now < stored) {
        this.restrictedUntil.set(endpoint, stored);
        return true;
      }
    } catch {
      // Store failures must never break requests.
    }
    return false;
  }

  private markRestricted(endpoint: string): void {
    const until = Date.now() + RESTRICTION_TTL_MS;
    this.restrictedUntil.set(endpoint, until);
    try {
      this.restrictionStore?.setRestriction(endpoint, until);
    } catch {
      // Store failures must never break requests.
    }
  }

  private isRateLimited(endpoint: string): boolean {
    const until = this.rateLimitedUntil.get(endpoint);
    if (until === undefined) return false;
    if (Date.now() < until) return true;
    this.rateLimitedUntil.delete(endpoint);
    return false;
  }

  private markRateLimited(endpoint: string, retryAfterMs: number): void {
    const waitMs = Math.min(Math.max(1000, retryAfterMs), RATE_LIMIT_TTL_MS);
    this.rateLimitedUntil.set(endpoint, Date.now() + waitMs);
  }

  async request(
    path: string,
    paramsOrBody: unknown = {},
    method: HttpMethod = 'GET',
    signal?: AbortSignal,
  ): Promise<unknown> {
    const isGet = method === 'GET';
    let urlStr = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    let bodyStr: string | undefined;
    if (isGet) {
      if (paramsOrBody && typeof paramsOrBody === 'object') {
        const url = new URL(urlStr);
        for (const [k, v] of Object.entries(paramsOrBody as Record<string, string>)) {
          url.searchParams.set(k, String(v));
        }
        urlStr = url.toString();
      }
    } else if (
      paramsOrBody &&
      typeof paramsOrBody === 'object' &&
      Object.keys(paramsOrBody).length > 0
    ) {
      bodyStr = JSON.stringify(paramsOrBody);
    }

    const cacheKey = `${method} ${urlStr}`;
    if (isGet && this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const ctx: FetchContext = {
      tokenProvider: this.tokenProvider,
      urlStr,
      method,
      bodyStr,
      isGet,
      signal,
      responseCache: this.responseCache,
      markRateLimited: (endpoint, retryAfterMs) => this.markRateLimited(endpoint, retryAfterMs),
    };

    const p = (async () => {
      const started = Date.now();
      const endpoint = new URL(urlStr).pathname;
      // A remembered restriction short-circuits silently (no request line,
      // no fetch, no error): it was already recorded with full details on
      // the first refusal, and callers treat it like the real 403/404.
      if (isDeprecatedEndpoint(endpoint) && this.isRestricted(endpoint)) {
        throw new ApiError(
          'API_UNAVAILABLE',
          `FORBIDDEN: 403 endpoint restricted (${endpoint})`,
          403,
          false,
        );
      }
      // A live rate-limit ban short-circuits silently (no request line, no
      // fetch, no error report): the first refusal was already recorded with
      // full details, and repeat calls must not extend Spotify's ban.
      if (this.isRateLimited(endpoint)) {
        if (isGet && this.responseCache.has(urlStr)) {
          diagnostic('api', 'cached_fallback', { endpoint, status: 429 });
          return this.responseCache.get(urlStr);
        }
        throw new ApiError(
          'API_RATE_LIMITED',
          `RATE_LIMITED: 429 endpoint cooling down (${endpoint})`,
          429,
          true,
        );
      }
      diagnostic('api', 'request', { method, endpoint });
      try {
        const result = await doFetchRequest(ctx);
        diagnostic('api', 'response', { method, endpoint, durationMs: Date.now() - started });
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'API_RATE_LIMITED') {
          diagnostic('api', 'rate_limited', { method, endpoint, status: 429 });
          throw error;
        }
        if (
          error instanceof ApiError &&
          error.code !== 'API_QUOTA_EXCEEDED' &&
          (error.status === 403 || error.status === 404) &&
          isDeprecatedEndpoint(endpoint)
        ) {
          this.markRestricted(endpoint);
          diagnostic('api', 'unavailable', { method, endpoint, status: error.status });
          throw error;
        }
        const id = reportFailure('api', `${method} ${endpoint}`, error);
        if (error instanceof Error) Object.assign(error, { diagnosticId: id });
        throw error;
      } finally {
        if (isGet) {
          this.inFlight.delete(cacheKey);
        }
      }
    })();

    if (isGet) {
      this.inFlight.set(cacheKey, p);
    }
    return p;
  }
}
