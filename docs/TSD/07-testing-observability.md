# TSD 07 — Testing, Observability, and Reliability

## 1. Testing Principles

- Test behavior at architectural boundaries.
- Prefer deterministic fakes over live Spotify calls in normal CI.
- Live Spotify tests are opt-in and MUST NOT be required for pull-request correctness.
- Regressions in playback isolation, IPC, authentication security, and terminal restore are release blockers.

## 2. Test Pyramid

### Unit Tests

High volume, fast:

- domain mappers;
- command registry;
- state machines;
- cache keys/TTL;
- adaptive FPS algorithm;
- FFT band grouping/smoothing;
- lyrics active-line selection;
- error mapping.

### Component/Integration Tests

- TypeScript application with FakePlayerPort/FakeSpotifyApiPort;
- Rust player application with fake playback engine/audio sink;
- SQLite migrations/cache;
- protocol fixture compatibility;
- player supervisor restart behavior.

### End-to-End Tests

Packaged `spotoei` + fake player sidecar for deterministic UI flows, plus a small opt-in live integration suite.

## 3. TypeScript Tooling

Use `bun:test` for unit/integration tests unless a demonstrated limitation requires another runner.

Avoid adding Jest/Vitest merely for familiarity.

Use dependency injection through ports so tests do not patch global `fetch` broadly.

## 4. Rust Tooling

- `cargo test`
- `cargo clippy --all-targets --all-features -- -D warnings` in CI for project code with carefully scoped allowances for upstream/generated behavior
- `cargo fmt --check`
- `cargo deny check` for dependency advisories/license/source policy

Where useful:

- property tests for protocol/normalization boundaries MAY be introduced;
- loom/model-checking is NOT required for MVP unless concurrency bugs justify it.

## 5. Fake Player

Implement a deterministic fake player executable or in-process adapter capable of scripting:

- normal playback lifecycle;
- buffering;
- queue change;
- lyrics synced/plain/unavailable;
- audio error;
- crash/exit;
- delayed response;
- malformed protocol event;
- high-rate visualizer frames.

This is critical for UI development without requiring a live Premium account.

## 6. Spotify API Fake

Use fixtures/SPOTOEI domain responses rather than copying giant raw Spotify responses throughout tests.

Infrastructure adapter tests may use curated raw HTTP fixtures to verify mapping and error handling.

Required cases:

- 200 page;
- 401 refresh then success;
- 401 refresh failure;
- 403 policy restriction;
- 429 rate limited;
- 429 quota exceeded reason;
- malformed/changed payload;
- network timeout;
- pagination.

## 7. Auth Tests

See TSD 02. Additionally, release CI MUST scan common test/output artifacts to ensure obvious token-like fixture secrets are fake and no real credentials are committed.

## 8. Audio/Visualizer Tests

Generate deterministic signals:

- sine at known frequencies;
- silence;
- impulse;
- stereo phase cases;
- clipped/max-amplitude samples.

Assert:

- expected band neighborhood dominates for sine signals;
- output is finite and bounded;
- silence decays to zero;
- peak decay is monotonic under silence;
- analyzer never blocks fake sink beyond a strict local threshold;
- frame dropping keeps bounded memory.

## 9. Adaptive FPS Tests

Feed synthetic frame timings.

Scenarios:

- healthy 60 FPS remains 60;
- sustained misses cause one downgrade to 30;
- transient single hitch does not downgrade;
- stable recovery returns to 60;
- cooldown prevents oscillation;
- visualizer off suppresses rate work.

## 10. UI Golden/Snapshot Tests

Use sparingly for stable critical surfaces:

- onboarding;
- wide main shell;
- narrow main shell;
- Command Palette;
- Lyrics synced/plain empty state;
- player-recovering banner.

Do not snapshot every component. Excessive snapshots create noisy maintenance and violate KISS.

## 11. Fault Injection

Release candidate testing SHOULD include:

- kill player sidecar during playback;
- kill network/API access while audio continues/buffers;
- corrupt cache DB;
- remove keyring availability;
- resize terminal rapidly;
- send malformed IPC line;
- flood visualizer frames;
- disconnect audio device where test platform permits.

## 12. Logging

### TypeScript

Use a small project logging abstraction wrapping stderr/file output as appropriate.

### Rust

Use `tracing` + `tracing-subscriber`.

### Levels

- ERROR: user-impacting failure requiring attention;
- WARN: degraded/recovered condition;
- INFO: startup/auth state transitions/recovery summaries;
- DEBUG: detailed request/IPC/control flow without secrets;
- TRACE: opt-in development only.

## 13. Correlation

Commands carry request IDs. Logs SHOULD include:

- request/command ID;
- player process instance ID;
- protocol sequence/revision where relevant.

Do not log access tokens just because they are part of a structured object.

## 14. Diagnostic IDs

Unexpected internal errors shown to the user SHOULD receive a short diagnostic/correlation ID that can be located in local logs without exposing raw stack traces in the TUI.

## 15. Metrics

No remote telemetry backend in MVP.

Internal/local counters MAY support diagnostics/benchmarks:

- player restart count;
- API rate/quota errors;
- visualizer dropped frames;
- 60→30 transitions;
- IPC malformed message count;
- cache hit/miss count.

These remain local unless future telemetry is explicitly designed and documented.

## 16. Performance Regression Gates

CI or scheduled benchmarks SHOULD track:

- cold TUI shell startup;
- warm cache startup;
- player handshake time using fake player;
- visualizer renderer CPU with 60 FPS synthetic frames;
- FFT analyzer CPU;
- memory after long fake playback session;
- search result render with large list.

Do not make unstable microbenchmarks hard release gates until the environment is controlled.

## 17. Reliability Targets

Engineering objectives:

- zero unbounded queues in high-frequency paths;
- no known secret leakage in logs/cache;
- player crash does not crash TUI;
- API error does not crash playback;
- cache corruption is recoverable;
- terminal is restored on normal and handled abnormal exits;
- repeated player crash loop is bounded.

## 18. Definition of a Release-Blocking Bug

Examples:

- playback audio corrupted by visualizer work;
- refresh token written to plaintext file;
- terminal left unusable after common exit path;
- `spotoei` crashes on Web API 429/403;
- UI queue diverges materially from player queue;
- sidecar crash kills parent UI;
- packaged binary requires undocumented developer toolchain dependency;
- auth callback can bind externally or accepts wrong state.
