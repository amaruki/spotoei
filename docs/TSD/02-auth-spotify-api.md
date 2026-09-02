# TSD 02 — Authentication and Spotify API Strategy

## 1. Goals

- Support public/open-source distribution without relying on one shared SPOTOEI Client ID.
- Provide browser-based login with no Client Secret.
- Keep Web API and playback credentials separable.
- Persist secrets only through the OS credential store.
- Minimize API requests and isolate Spotify API changes behind adapters.

## 2. BYO Client ID

Each user configures a Spotify Developer application and provides its Client ID to SPOTOEI.

Rationale:

- Spotify Development Mode is intentionally constrained and currently allows only a small allowlist per app.
- Development Mode quota is tied to the developer account budget rather than being a scalable public-app distribution mechanism.
- Extended quota is not an appropriate MVP dependency for a small open-source project.

SPOTOEI MUST therefore avoid a shared public Client ID as its default operating mode.

## 3. OAuth Flow

Use Authorization Code with PKCE.

### 3.1 Callback

- Bind only to loopback.
- Use `127.0.0.1`, not `localhost`.
- Prefer a dynamically selected available port if supported by the registered Spotify redirect behavior.
- Callback path SHOULD be stable, e.g. `/callback`.
- Validate OAuth `state`.
- Reject unexpected methods/paths and malformed callbacks.
- Return a minimal browser page telling the user to return to SPOTOEI.

### 3.2 PKCE

- Generate a cryptographically random code verifier.
- Use S256 challenge.
- Keep verifier only for the in-progress authorization transaction.
- Never log verifier, code, access token, or refresh token.

## 4. Identity Separation

Define two logical credentials:

```text
AuthContext
├─ WebApiCredential
└─ PlaybackCredential
```

A single PKCE token MAY be used to seed both when the pinned librespot version supports the required token/session behavior reliably.

The architecture MUST permit:

```text
OAuth A → Web API
OAuth B → playback
```

without changing presentation/application interfaces.

This protects SPOTOEI from upstream scope/session incompatibilities.

## 5. Credential Vault

Persistent sensitive credentials are managed through Rust's OS-keyring adapter.

Recommended logical keys:

```text
service: "spotoei"
entries:
  web-api-refresh:<account-id>
  playback-refresh-or-credential:<account-id>
```

The exact keyring backend is platform-dependent.

### 5.1 Keyring Unavailable

If no secure OS credential store is available:

- SPOTOEI MUST NOT silently write refresh tokens into config or SQLite.
- It MAY keep tokens in memory for the current run.
- The UI MUST state that login will not persist.

This is deliberately less convenient than an insecure fallback.

## 6. Client ID Storage

Client ID is not treated as a secret and MAY be stored in config.

Client Secret MUST NOT be requested, generated, stored, or supported in the desktop MVP flow.

## 7. Token Ownership

Recommended design:

- Rust vault owns persistent refresh material.
- TypeScript Web API client requests a usable access token through `AuthPort`/IPC.
- Access tokens MAY exist in TypeScript memory for request execution but MUST never be persisted by the TS cache/config layer.
- Refresh is coordinated by the auth component so multiple UI requests do not trigger concurrent refresh storms.

## 8. OAuth Scopes

Use least privilege and feature-driven scope composition.

Expected MVP categories may require scopes equivalent to:

- library read/write;
- private/collaborative playlist read;
- playlist modification when the feature is enabled;
- recently played;
- top items;
- follow read/write only if exposed by the final MVP UI.

Do NOT request `user-read-email` unless a future feature specifically requires it.

Do NOT request Web API playback-control scopes merely to mirror state that already comes from the local playback core.

The exact scope list MUST be verified against Spotify's current API before release because endpoint/scope behavior changes over time. For post-MVP Insights, the scopes `user-top-read` and `user-read-recently-played` follow the same least-privilege rule; missing scopes degrade the affected Insights section only, which surfaces a per-section reauth affordance while playback remains independent (see `TSD 11 §15`).

## 9. Web API Client

Use Bun/native `fetch` behind a SPOTOEI-owned adapter.

No component outside the infrastructure adapter may construct Spotify endpoint URLs.

Responsibilities:

- attach bearer token;
- set user agent where appropriate;
- parse HTTP/error responses;
- validate important response shapes at adapter boundaries;
- map Spotify types to SPOTOEI domain types;
- implement pagination;
 - detect 401/403/429 and 5xx (`500`/`502`/`503`) for contract coverage (`TSD 11 §18.2`);
 - honor `Retry-After` when supplied;
 - classify quota-exceeded response reason separately when available;
 - deduplicate safe concurrent identical GETs.

## 10. Request Policy

### 10.1 Search

- Debounce approximately 250-350 ms.
- Cancel/ignore stale search requests when the query changes.
- Cache short-lived successful results.

### 10.2 Library

- Incremental pagination.
- Cache pages/entities.
- Background refresh should prefer stale-while-revalidate behavior.

### 10.3 Playback

Do NOT poll `/me/player` or equivalent real-time playback endpoints for ordinary local playback state.

Player-core events are authoritative.

## 11. Cache Policy for API Responses

Suggested defaults, subject to tuning:

| Data | Suggested TTL/Strategy |
|---|---|
| immutable-ish track/album metadata | 24 h to 7 d |
| artist metadata | 24 h |
| search query results | 5-15 min |
| saved/library pages | 1-5 min with stale-while-revalidate |
| playlist metadata | 1-5 min |
| recently played | 1-5 min |
| top items | 1 h |

TTL is a performance policy, not correctness authority. User mutations MUST update/invalidate relevant cache entries immediately.

## 12. Mutation Consistency

For actions such as Save/Like:

1. invoke use case;
2. perform API mutation;
3. on success, update local cache/projection;
4. publish UI state update;
5. on failure, retain previous authoritative state and show compact error.

Optimistic UI MAY be used only where rollback is unambiguous.

## 13. Quota/Rate-Limit Handling

Classify at least:

- `RATE_LIMITED`: HTTP 429 not classified as quota exhaustion;
- `QUOTA_EXCEEDED`: Spotify response explicitly identifies Development Mode quota exhaustion;
- `FORBIDDEN`: 403 permission/restriction;
- `AUTH_EXPIRED`: unrecoverable 401 after one refresh attempt.

Do not retry quota exhaustion aggressively.

For rate limiting, respect server-provided delay and coalesce UI refreshes.

## 14. API Capability/Restriction Layer

Spotify's Web API may restrict data differently depending on quota mode and endpoint changes. The adapter SHOULD expose capability-aware results rather than forcing every caller to understand Spotify policy.

Example:

```ts
interface PlaylistDetailsResult {
  playlist: Playlist;
  tracks: Track[];
  completeness: "complete" | "partial" | "unavailable";
  reason?: "spotify-policy" | "permission" | "network";
}
```

UI then renders a user-facing limitation without coupling to HTTP status details.

## 15. Logout

Logout MUST:

- stop/release the playback session;
- erase persisted SPOTOEI credentials for the active account from keyring;
- clear in-memory access tokens;
- optionally preserve non-sensitive cache only if it is scoped by account ID and cannot expose sensitive profile data across users;
- return to onboarding/account state.

A `Clear local data` action SHOULD separately remove cache/config as appropriate.

## 16. Security Tests

Required tests include:

- PKCE state mismatch rejected;
- malformed callback rejected;
- callback not bound to external interface;
- token values redacted from logs;
- refresh token absent from config and SQLite;
- concurrent refresh requests coalesce;
- 401 triggers at most one refresh/retry cycle per request path;
- quota 429 is not hot-loop retried;
- logout removes keyring entries.

## 17. External Reference Snapshot

Baseline verified 2026-09-02:

- Spotify Development Mode allows up to 5 authenticated users per app and requires the app owner to be Premium.
- Spotify's July 2026 update counts Development Mode quota per developer account and includes a structured `QUOTA_EXCEEDED` reason for quota exhaustion.
- Spotify requires explicit loopback IP literals for HTTP redirect URIs and does not allow `localhost`.
- librespot OAuth supports Authorization Code + PKCE and documents that sufficient-scope tokens may be used for Web API and/or a librespot session.

Implementation MUST re-verify these external rules for each significant release.
