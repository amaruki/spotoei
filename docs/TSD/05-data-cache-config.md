# TSD 05 — Data Cache, Configuration, and Local Storage

## 1. Principles

- Cache improves responsiveness; it is not an authoritative replacement for Spotify.
- Secrets never enter SQLite/config.
- Prefer Bun built-ins to third-party persistence dependencies.
- Migrations are explicit and forward-only for released schemas.
- Account-specific data is namespaced by stable account identity.

## 2. SQLite

Use `bun:sqlite` in the TypeScript process.

Database file: `cache.db` inside the platform cache directory (see §9). `SPOTOEI_CACHE_FILE` overrides the path, and `:memory:` is used in test runs.

Enable WAL mode when supported for reliable concurrent read/write behavior within the process and good responsiveness.

Only one SPOTOEI UI process is expected to own a given cache in MVP. Multi-instance locking behavior SHOULD fail safely rather than corrupt data.

## 3. Suggested Schema

The exact columns may evolve, but separate generic entities from query/index cache.

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE entities (
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (account_id, entity_type, entity_id)
);

CREATE TABLE query_cache (
  account_id TEXT NOT NULL,
  query_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (account_id, query_key)
);

CREATE TABLE library_index (
  account_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT NOT NULL,
  position INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, collection, item_id)
);
```

Do not over-normalize Spotify metadata in MVP. JSON payloads behind SPOTOEI-owned validated cache models are acceptable and reduce migration burden.

## 4. Cache Keys

Use deterministic keys such as:

```text
search:v1:<normalized-query>:<types>:<page>
library:v1:saved-tracks:<offset>
playlist:v1:<id>:tracks:<page>
recent:v1:<limit>
top:v1:<type>:<range>:<page>
```

Cache-key construction MUST be centralized and keys MUST be `account_id`-scoped.

## 5. Cache Read Strategy

Preferred stale-while-revalidate:

1. query cache;
2. if fresh, render immediately;
3. if stale but usable, render stale result and asynchronously refresh;
4. if absent, show panel-local loading and fetch;
5. update cache transactionally on success.

## 6. Cache Invalidation

User mutation invalidates or updates relevant entries immediately.

Examples:

- Like/save → update track entity + saved-track index.
- Playlist mutation → invalidate affected playlist pages.
- Logout → remove account-scoped query/library cache if privacy mode requires; otherwise keep only if account partitioning is guaranteed and UX explicitly allows it.

Default recommendation: retain non-secret metadata cache per account for faster re-login, with `Clear local data` available.

## 7. Configuration

Use a small JSON configuration file to avoid a parser dependency and keep programmatic migration simple.

Example (actual schema):

```json
{
  "version": 1,
  "spotify": {
    "clientId": "...",
    "redirectPort": 8989
  },
  "playback": {
    "volume": 0.8,
    "autoplay": true
  },
  "browse": {
    "charts": [],
    "editorialPlaylists": [],
    "drivingPlaylistUris": []
  }
}
```

Unspecified fields fall back to defaults. `browse` entries are validated before use.

Refresh/access tokens are prohibited in this file.

## 8. Config Validation

Use Zod at load boundary.

Rules:

- invalid optional fields fall back to defaults with a warning;
- invalid security-critical fields fail explicitly;
- unknown fields SHOULD be preserved where practical during config update to reduce downgrade/forward-version damage;
- config migration is versioned.

## 9. Filesystem Paths

Use platform conventions:

### Linux

- config: `$XDG_CONFIG_HOME/spotoei/` or `~/.config/spotoei/`
- cache: `$XDG_CACHE_HOME/spotoei/` or `~/.cache/spotoei/`
- state/logs: `$XDG_STATE_HOME/spotoei/` where applicable

### macOS

Use appropriate `~/Library/Application Support/`, `~/Library/Caches/`, and Logs/State conventions.

### Windows

Use `%APPDATA%`/`%LOCALAPPDATA%` conventions as appropriate.

Path logic MUST be centralized in a platform-path adapter.

## 10. Logs

Logs are not stored in SQLite.

Default logs SHOULD be compact and rotated/capped. Debug logs MAY be opt-in.

Logs MUST redact:

- access tokens;
- refresh tokens;
- authorization codes;
- PKCE verifier;
- reusable playback credentials;
- full raw OAuth callback query strings.

## 11. Database Migrations

Migration policy:

- integer sequential versions;
- one transaction per migration where SQLite permits;
- backup/rebuild only when necessary;
- application refuses to open a cache schema newer than it understands unless read-only handling is explicitly supported;
- cache corruption may be recovered by rebuilding the cache because no critical secrets or sole authoritative user data live there.

## 12. Cache Corruption Recovery

On integrity/open failure:

1. close DB;
2. rename corrupt cache with timestamp if possible;
3. create a fresh cache;
4. show a non-blocking warning;
5. never delete credential-store secrets as part of cache repair.

`spotoei doctor` reports integrity status.

## 13. Size Management

Implement periodic low-priority cleanup:

- remove expired query cache entries;
- prune old entity payloads not referenced by recent/library indexes;
- keep database size bounded by configurable or reasonable defaults.

Cleanup MUST not run on the audio path and SHOULD yield to user interaction.

## 14. Tests

- schema migration from every released version;
- corrupted-cache recovery;
- stale-while-revalidate behavior;
- mutation invalidation;
- account namespace isolation;
- token-like values never written to DB/config fixtures;
- XDG/macOS/Windows path selection;
- config defaulting/migration;
- concurrent identical reads/writes remain deterministic.
