// Error banners, Retry-After parsing, and the ApiError type shared by the
// Web API transport.

export const QUOTA_BANNER = 'Library temporarily unavailable \u00b7 Spotify API quota exceeded';
export const BROWSE_QUOTA_BANNER = QUOTA_BANNER;
export const SEARCH_QUOTA_BANNER = QUOTA_BANNER;

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
