# SPOTOEI Technical Specification Index

**Document Set:** SPOTOEI-TSD  
**Baseline:** 1.0.0-draft  
**Last Updated:** 2026-09-02

## 1. Purpose

This directory contains the modular Technical Specification Documents for the SPOTOEI MVP. The FSD defines what the product must do; these TSDs define how the implementation is structured while preserving those behaviors.

## 2. Locked Architectural Decisions

The following decisions are baseline constraints:

1. Product name: **SPOTOEI**.
2. Presentation application: **TypeScript + React + OpenTUI**, executed/bundled with Bun.
3. Playback core: **Rust + librespot**.
4. No daemon mode in MVP.
5. Process model: `spotoei` launches and supervises `spotoei-player` as a child process.
6. IPC: versioned **NDJSON over stdin/stdout**.
7. Playback state source of truth: Rust player core.
8. UI state: React local state + Jotai for shared UI/domain projections + XState for coarse lifecycle machines.
9. Visualizer data bypasses Jotai/XState high-frequency state and uses a dedicated subscription/controller.
10. Visualizer default: **60 FPS**, adaptive fallback to **30 FPS** under sustained UI lag, then recover to 60 FPS with hysteresis.
11. Visualizer modes in MVP: Spectrum, Winamp-style, Oscilloscope, Off.
12. Equalizer and SPOTOEI-managed crossfade are post-MVP.
13. Lyrics are MVP: timed/synced when possible, plain fallback otherwise.
14. Authentication: user-provided Spotify Client ID + Authorization Code with PKCE + loopback `127.0.0.1`.
15. Web API identity and playback identity remain architecturally separable.
16. Persistent secrets use the OS credential store; no plaintext-token fallback.
17. Spotify Web API is not the real-time playback source of truth.
18. Cache: built-in `bun:sqlite`; HTTP: built-in `fetch`.
19. Packaged users do not install Bun/Node/Rust/librespot manually.
20. MVP ships two executables in one package rather than forcing single-file self-extraction.

## 3. TSD Map

| File | Responsibility |
|---|---|
| `01-system-architecture.md` | Component/process/layer architecture and dependency rules |
| `02-auth-spotify-api.md` | PKCE, token lifecycle, credential vault, API client, quota behavior |
| `03-playback-audio-visualizer.md` | librespot integration, audio pipeline, queue, autoplay, FFT, adaptive FPS |
| `04-ui-ux-state.md` | OpenTUI/React composition, navigation, Jotai/XState boundaries, Lyrics |
| `05-data-cache-config.md` | SQLite cache, configuration, filesystem paths, migrations |
| `06-ipc-contract.md` | Versioned NDJSON command/event protocol |
| `07-testing-observability.md` | Test strategy, fault injection, logging, metrics/benchmarks |
| `08-packaging-release.md` | Build matrix, installer/package strategy, checksums, `doctor` |
| `09-coding-standards.md` | Clean Code, Clean Architecture, KISS, DRY, TypeScript/Rust conventions |
| `10-implementation-plan.md` | Delivery slices, gates, Definition of Done |
| `11-analytical-insights-view.md` | Compliance-constrained Insights view using Spotify-provided Top Items and Recently Played data |

## 4. Dependency Baseline

### TypeScript Runtime Dependencies

- `react` >= 19.2
- `@opentui/core`
- `@opentui/react`
- `jotai`
- `xstate`
- `@xstate/react`
- `zod`

The implementation SHOULD avoid adding dependencies when Bun or the platform already provides the required primitive.

### TypeScript Development Dependencies

- `oxlint`
- `oxfmt`
- TypeScript tooling supplied/required by the selected Bun/OpenTUI template

### Rust Development Tooling

- `rustfmt` for canonical formatting
- Clippy for linting and idiomatic/correctness checks
- `cargo-deny` for dependency advisories, licenses, bans, and source policy
- `cargo-machete` MAY be used as a non-blocking/periodic unused-dependency check

### Rust Runtime Crates

- `librespot` pinned to a reviewed version/revision
- `tokio`
- `serde`
- `serde_json`
- `rustfft`
- `keyring`
- `tracing`
- `tracing-subscriber`
- small support crates only when they remove meaningful platform-specific complexity

`rodio`/`cpal` normally arrive through the selected librespot playback backend and SHOULD NOT be duplicated directly unless SPOTOEI requires a capability unavailable through librespot's public interfaces.

## 5. Standards

The implementation SHALL use:

- RFC 2119 / RFC 8174 normative terminology in specifications;
- OAuth 2.0 Authorization Code + PKCE principles (RFC 6749, RFC 7636, RFC 8252 native-app guidance);
- Semantic Versioning for published SPOTOEI versions;
- Conventional Commits for repository commits;
- explicit schema/protocol versioning for IPC and cache migrations.

## 6. Architectural Quality Priorities

When requirements compete, use this priority order:

1. Prevent credential exposure and unsafe behavior.
2. Preserve uninterrupted/correct audio playback.
3. Preserve deterministic playback/control state.
4. Preserve UI responsiveness and terminal recovery.
5. Preserve API quota efficiency.
6. Prefer implementation simplicity.
7. Optimize visual fidelity last.

## 7. External Dependency Policy

Spotify behavior and librespot internals are not controlled by SPOTOEI. All integration points MUST be wrapped by SPOTOEI-owned ports/adapters so upstream changes do not leak into presentation/domain code.

No TUI component may import a Spotify transport client or librespot-specific representation directly.
