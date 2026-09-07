// Transport layer for Spotify Web API HTTP communication.
// Handles auth token resolution, in-flight request deduplication,
// 401 token refresh retries, and 429 rate limit backoff.

import type { HttpMethod, TokenPayload, TokenProvider } from './types';
import { diagnostic, reportFailure } from '../diagnostics';

export const QUOTA_BANNER = 'Library temporarily unavailable \u00b7 Spotify API quota exceeded';
export const BROWSE_QUOTA_BANNER = QUOTA_BANNER;
export const SEARCH_QUOTA_BANNER = QUOTA_BANNER;

// Endpoints Spotify deprecated for dev apps without Extended Quota
// (Nov 2024 + Feb 2026 changes). A 403/404 here is an expected platform
// restriction, not an app bug.
const DEPRECATED_PATTERNS: RegExp[] = [
  /\/v1\/browse\/new-releases$/,
  /\/v1\/browse\/featured-playlists$/,
  /\/v1\/browse\/categories$/,
  /\/v1\/browse\/categories\/.+\/playlists$/,
  /\/v1\/recommendations$/,
  /\/v1\/artists\/.+\/top-tracks$/,
  /\/v1\/artists\/.+\/related-artists$/,
];

// Persistent memory for endpoint restrictions. The default Transport keeps
// this in memory; the app wires a SQLite-backed store so a restriction
// learned in a previous run still suppresses the doomed request (silently)
// instead of re-probing Spotify on every cold start.
export interface RestrictionStore {
  getRestriction(endpoint: string): number | undefined;
  setRestriction(endpoint: string, until: number): void;
}

export function isDeprecatedEndpoint(pathname: string): boolean {
  return DEPRECATED_PATTERNS.some((re) => re.test(pathname));
}

// How long a 403/404 on a deprecated endpoint suppresses repeat network
// calls (callers' fallbacks throw the cached refusal instead). Bounds
// staleness in case the restriction lifts on re-auth or quota approval.
const RESTRICTION_TTL_MS = 10 * 60 * 1000;

// Upper bound for honoring Spotify's Retry-After on 429s. Longer bans are
// still respected, but the local memory of them is capped so a stale ban
// cannot suppress an endpoint forever.
const RATE_LIMIT_TTL_MS = 120 * 1000;

/**
 * Parse a Retry-After header value (delta seconds) into milliseconds.
 * Returns 0 when the header is missing or unparsable.
 */
export function parseRetryAfterMs(value: string | null | undefined): number {
  if (!value) return 0;
  const seconds = Number.parseFloat(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * 1000);
}

export class ApiError extends Error {
  code:
    | 'API_RATE_LIMITED'
    | 'API_QUOTA_EXCEEDED'
    | 'API_UNAVAILABLE'
    | 'AUTH_EXPIRED'
    | 'FORBIDDEN';
  diagnosticId = crypto.randomUUID().slice(0, 8);
  retryable: boolean;
  status: number;
  constructor(code: ApiError['code'], message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Preserves previous refresh_token when a token refresh response returns
 * a new access_token without a new refresh_token (#1040 parity).
 */
export function preserveRefreshToken(
  previousRefreshToken: string | null | undefined,
  refreshedToken:
    | Record<string, unknown>
    | { refresh_token?: string | null; refreshToken?: string | null }
    | null
    | undefined,
): string | undefined {
  if (!refreshedToken || typeof refreshedToken !== 'object') {
    return previousRefreshToken ?? undefined;
  }
  const next =
    'refresh_token' in refreshedToken && typeof refreshedToken.refresh_token === 'string'
      ? refreshedToken.refresh_token
      : 'refreshToken' in refreshedToken && typeof refreshedToken.refreshToken === 'string'
        ? refreshedToken.refreshToken
        : undefined;
  if (next && next.trim().length > 0) {
    return next;
  }
  return previousRefreshToken ?? undefined;
}

/**
 * Merges a refresh token response into existing credentials, preserving the existing
 * refresh_token if the response omitted or nullified it (#1040 parity).
 */
export function mergeTokenRefresh<T extends Record<string, unknown>>(
  current: TokenPayload | string | null | undefined,
  refreshed: T,
): T & { refresh_token?: string; refreshToken?: string } {
  const prevRefresh =
    typeof current === 'string' ? current : (current?.refreshToken ?? current?.refresh_token);

  const ref = refreshed as Record<string, unknown>;
  const nextRefresh = ref.refresh_token ?? ref.refreshToken;
  if (!nextRefresh || (typeof nextRefresh === 'string' && !nextRefresh.trim())) {
    if (prevRefresh) {
      if ('refresh_token' in ref || !('refreshToken' in ref)) {
        return {
          ...refreshed,
          refresh_token: prevRefresh,
        };
      } else {
        return {
          ...refreshed,
          refreshToken: prevRefresh,
        };
      }
    }
  }
  return refreshed;
}

export class Transport {
  private tokenProvider: TokenProvider;
  private baseUrl: string;
  private inFlight = new Map<string, Promise<unknown>>();
  // Endpoints recently refused with 403/404 as a platform restriction
  // (pathname -> timestamp when the restriction entry expires).
  private restrictedUntil = new Map<string, number>();
  private restrictionStore?: RestrictionStore;
  // Endpoints currently serving a Spotify 429 ban (pathname -> timestamp
  // when the ban entry expires). Repeat calls fail fast without touching
  // the network, so a hot loop cannot extend Spotify's ban.
  private rateLimitedUntil = new Map<string, number>();
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
    const waitMs = Math.min(Math.max(0, retryAfterMs), RATE_LIMIT_TTL_MS);
    if (waitMs > 0) this.rateLimitedUntil.set(endpoint, Date.now() + waitMs);
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

    const doFetch = async (retryCount = 0): Promise<unknown> => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const token = await this.tokenProvider.getAccessToken().catch((error: unknown) => {
        const id = reportFailure('ipc', 'auth.getWebToken', error);
        if (error instanceof Error) Object.assign(error, { diagnosticId: id });
        throw error;
      });
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'spotoei/0.0.0',
      };
      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
      }

      const timeoutSignal = AbortSignal.timeout(10000);
      const combinedSignal = signal
        ? typeof AbortSignal.any === 'function'
          ? AbortSignal.any([timeoutSignal, signal])
          : signal
        : timeoutSignal;

      const res = await fetch(urlStr, {
        method,
        headers,
        ...(bodyStr ? { body: bodyStr } : {}),
        signal: combinedSignal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let detail = res.statusText;
        try {
          const parsed = JSON.parse(errBody) as {
            error?: { message?: string; reason?: string } | string;
          };
          if (typeof parsed?.error === 'object' && parsed.error?.message) {
            detail = parsed.error.message;
          } else if (typeof parsed?.error === 'object' && parsed.error?.reason) {
            detail = parsed.error.reason;
          } else if (typeof parsed?.error === 'string') {
            detail = parsed.error;
          } else if (errBody.trim()) {
            detail = errBody.trim();
          }
        } catch {
          if (errBody.trim()) {
            detail = errBody.trim();
          }
        }

        const isQuota = /quota/i.test(errBody) || /quota/i.test(detail);
        if (isQuota) {
          throw new ApiError(
            'API_QUOTA_EXCEEDED',
            `QUOTA_EXCEEDED: ${res.status} Quota exceeded (${detail})`,
            res.status,
            false,
          );
        }

        if (res.status === 401 && retryCount === 0) {
          await this.tokenProvider.invalidateToken?.();
          return doFetch(retryCount + 1);
        }
        if (res.status === 401) {
          throw new ApiError(
            'AUTH_EXPIRED',
            `AUTH_EXPIRED: 401 Unauthorized (${detail})`,
            401,
            false,
          );
        }

        if (res.status === 429 && retryCount === 0) {
          const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '1', 10);
          const waitMs = Math.max(1, isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000;
          // Long backoffs return to the UI without retrying too early.
          if (waitMs <= 1000) {
            diagnostic('api', 'retry', { endpoint: new URL(urlStr).pathname, status: 429, waitMs });
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            return doFetch(retryCount + 1);
          }
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          this.markRateLimited(new URL(urlStr).pathname, parseRetryAfterMs(retryAfter));
          throw new ApiError(
            'API_RATE_LIMITED',
            `RATE_LIMITED: 429 Too Many Requests (retry after ${retryAfter ?? 'unknown'}s)`,
            429,
            true,
          );
        }

        if (res.status === 403) {
          throw new ApiError('FORBIDDEN', `FORBIDDEN: 403 Forbidden (${detail})`, 403, false);
        }
        throw new ApiError(
          'API_UNAVAILABLE',
          `HTTP_${res.status}: ${detail}`,
          res.status,
          res.status >= 500,
        );
      }

      if (res.status === 204) {
        return null;
      }
      const text = await res.text();
      if (!text.trim()) {
        return null;
      }
      return JSON.parse(text);
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
        throw new ApiError(
          'API_RATE_LIMITED',
          `RATE_LIMITED: 429 endpoint cooling down (${endpoint})`,
          429,
          true,
        );
      }
      diagnostic('api', 'request', { method, endpoint });
      try {
        const result = await doFetch();
        diagnostic('api', 'response', { method, endpoint, durationMs: Date.now() - started });
        return result;
      } catch (error) {
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
