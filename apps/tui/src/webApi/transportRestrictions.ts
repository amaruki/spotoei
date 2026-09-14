// Endpoint restriction and rate-limit memory shared by the Web API transport.

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
export const RESTRICTION_TTL_MS = 10 * 60 * 1000;

// Upper bound for honoring Spotify's Retry-After on 429s. Longer bans are
// still respected, but the local memory of them is capped so a stale ban
// cannot suppress an endpoint forever.
export const RATE_LIMIT_TTL_MS = 120 * 1000;
