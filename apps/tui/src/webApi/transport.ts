// Transport layer for Spotify Web API HTTP communication.
// Handles auth token resolution, in-flight request deduplication,
// 401 token refresh retries, and 429 rate limit backoff.

import type { HttpMethod, TokenProvider } from './types';

export class Transport {
  private tokenProvider: TokenProvider;
  private baseUrl: string;
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(tokenProvider: TokenProvider, baseUrl = 'https://api.spotify.com/v1') {
    this.tokenProvider = tokenProvider;
    this.baseUrl = baseUrl;
  }

  async request(
    path: string,
    paramsOrBody: unknown = {},
    method: HttpMethod = 'GET',
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
    } else if (paramsOrBody && typeof paramsOrBody === 'object' && Object.keys(paramsOrBody).length > 0) {
      bodyStr = JSON.stringify(paramsOrBody);
    }

    const cacheKey = `${method} ${urlStr}`;
    if (isGet && this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const doFetch = async (retryCount = 0): Promise<unknown> => {
      const token = await this.tokenProvider.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'spotoei/0.0.0',
      };
      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(urlStr, {
        method,
        headers,
        ...(bodyStr ? { body: bodyStr } : {}),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let detail = res.statusText;
        try {
          const parsed = JSON.parse(errBody) as { error?: { message?: string } | string };
          if (typeof parsed?.error === 'object' && parsed.error?.message) {
            detail = parsed.error.message;
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

        // 401 Unauthorized: invalidate token and retry once
        if (res.status === 401 && retryCount === 0) {
          this.tokenProvider.invalidateToken?.();
          return doFetch(retryCount + 1);
        }
        if (res.status === 401) {
          throw new Error(`AUTH_EXPIRED: 401 Unauthorized (${detail})`);
        }

        // 429 Too Many Requests: wait Retry-After seconds and retry once
        if (res.status === 429 && retryCount === 0) {
          const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '1', 10);
          const baseWaitMs = Math.min(10000, Math.max(1, isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000);
          const isBun = 'Bun' in globalThis;
          const waitMs = isBun ? Math.min(50, baseWaitMs) : baseWaitMs;
          await new Promise((r) => setTimeout(r, waitMs));
          return doFetch(retryCount + 1);
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          throw new Error(
            `RATE_LIMITED: 429 Too Many Requests (retry after ${retryAfter ?? 'unknown'}s)`,
          );
        }

        if (res.status === 403) {
          throw new Error(`FORBIDDEN: 403 Forbidden (${detail})`);
        }
        throw new Error(`HTTP_${res.status}: ${detail}`);
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
      try {
        return await doFetch();
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
