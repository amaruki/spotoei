// Single-shot fetch pipeline for Transport.request: auth resolution, error
// classification, 401 refresh retry, and 429 backoff. Extracted as a free
// function so the Transport class body stays under the 300 LoC ceiling.

import { diagnostic, reportFailure } from '../diagnostics';
import { ApiError, parseRetryAfterMs } from './transportErrors';
import type { HttpMethod, TokenProvider } from './types';

export interface FetchContext {
  tokenProvider: TokenProvider;
  urlStr: string;
  method: HttpMethod;
  bodyStr: string | undefined;
  isGet: boolean;
  signal: AbortSignal | undefined;
  responseCache: Map<string, unknown>;
  markRateLimited: (endpoint: string, retryAfterMs: number) => void;
}

export async function doFetchRequest(ctx: FetchContext, retryCount = 0): Promise<unknown> {
  const { tokenProvider, urlStr, method, bodyStr, isGet, signal } = ctx;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const token = await tokenProvider.getAccessToken().catch((error: unknown) => {
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
      await tokenProvider.invalidateToken?.();
      return doFetchRequest(ctx, retryCount + 1);
    }
    if (res.status === 401) {
      throw new ApiError('AUTH_EXPIRED', `AUTH_EXPIRED: 401 Unauthorized (${detail})`, 401, false);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const retryAfterMs = parseRetryAfterMs(retryAfter);
      const waitMs = Math.max(1000, retryAfterMs);
      const endpoint = new URL(urlStr).pathname;
      ctx.markRateLimited(endpoint, waitMs);

      // Retry rate-limited GET requests up to two times if wait <= 2s.
      // Mutation requests (POST, PUT, DELETE) are never delayed or retried.
      if (isGet && retryCount < 2 && waitMs <= 2000) {
        diagnostic('api', 'retry', {
          endpoint,
          status: 429,
          waitMs,
          retryCount: retryCount + 1,
        });
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, waitMs);
        await promise;
        return doFetchRequest(ctx, retryCount + 1);
      }

      // If retry not allowed or exhausted, fall back to cached data if available for GET
      if (isGet && ctx.responseCache.has(urlStr)) {
        diagnostic('api', 'cached_fallback', { endpoint, status: 429 });
        return ctx.responseCache.get(urlStr);
      }

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
  const parsed = JSON.parse(text);
  if (isGet) {
    ctx.responseCache.set(urlStr, parsed);
  }
  return parsed;
}
