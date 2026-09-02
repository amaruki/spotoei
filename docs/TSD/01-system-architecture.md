# TSD 01 — System Architecture

## 1. Scope

This document defines the process model, Clean Architecture boundaries, component responsibilities, startup/shutdown behavior, repository layout, and dependency direction for SPOTOEI.

## 2. Architecture Overview

```text
┌──────────────────────────────────────────────────────────────┐
│ spotoei (Bun standalone executable)                         │
│                                                              │
│  Presentation: React + OpenTUI                              │
│            │                                                 │
│  Application Use Cases                                      │
│            │                                                 │
│  Ports: PlayerPort / SpotifyApiPort / CachePort / AuthPort  │
│        │               │              │             │        │
│        │         HTTP adapter     bun:sqlite     IPC vault   │
└────────┼─────────────────────────────────────────────┼────────┘
         │ NDJSON stdin/stdout                         │
         ▼                                             │
┌──────────────────────────────────────────────────────┴───────┐
│ spotoei-player (Rust sidecar)                               │
│                                                              │
│  IPC Adapter → Player Application → Playback Domain         │
│                              │                               │
│                 Librespot Adapter / Credential Vault         │
│                              │                               │
│       Audio Sink → DSP tap → Rodio/CPAL → OS Audio          │
└──────────────────────────────────────────────────────────────┘
```

## 3. Process Model

MVP uses exactly two long-running project processes:

1. `spotoei`: owns terminal UI, Web API data access, cache, application navigation/state projection, and child supervision.
2. `spotoei-player`: owns Spotify playback session, authoritative playback state, queue/context, decoded PCM path, audio output, lyrics retrieval through the playback stack where available, and credential-vault operations delegated to Rust.

There is no standalone daemon, socket listener, background service, or system service in MVP.

## 4. Clean Architecture Layers

### 4.1 TypeScript Side

#### Presentation

May depend on application interfaces and state projections. MUST NOT know Spotify HTTP payload shapes or NDJSON wire details.

Examples:

- screens;
- panels;
- command palette;
- input/keymap handling;
- visualizer renderer;
- lyrics renderer.

#### Application

Contains use cases/orchestration such as:

- `SearchCatalog`;
- `OpenLibrary`;
- `PlayTrack`;
- `ToggleLike`;
- `OpenLyrics`;
- `RecoverPlayer`.

Application code depends on ports, not concrete adapters.

#### Domain/Models

Contains SPOTOEI-owned stable representations:

- `Track`;
- `Album`;
- `Artist`;
- `Playlist`;
- `PlaybackSnapshot`;
- `QueueSnapshot`;
- `LyricsDocument`;
- `AppError`.

Domain models MUST NOT expose Spotify JSON field layout or librespot protobuf/internal types.

#### Infrastructure Adapters

- Spotify Web API HTTP adapter;
- IPC player adapter;
- SQLite cache adapter;
- OS/browser launch adapter;
- config filesystem adapter.

### 4.2 Rust Side

#### IPC Adapter

Decodes/validates protocol messages and maps them to application commands.

#### Player Application

Coordinates command handling and publishes events. It owns no terminal concerns.

#### Playback Domain

Owns stable SPOTOEI playback concepts and invariants.

#### Infrastructure

- librespot session/connect/player adapters;
- audio sink/DSP;
- OS keyring;
- tracing/logging.

## 5. Dependency Rule

Dependencies point inward:

```text
Presentation → Application → Domain
Infrastructure ─────────────→ Ports/Domain
```

Forbidden examples:

- React component importing `fetch("https://api.spotify.com/...`)`;
- Jotai atom containing a librespot type;
- Rust librespot event serialized directly to the UI without mapping;
- SQLite row type reused as UI/domain model;
- UI component constructing raw IPC JSON strings.

## 6. Source of Truth Rules

### Playback

`spotoei-player` is authoritative for:

- play/pause/buffering state;
- playback position baseline;
- active context/track;
- playback queue snapshot;
- shuffle/repeat/autoplay state when exposed;
- audio device/output errors.

The UI may interpolate position for display between player events, but interpolation is a view concern and MUST be corrected by new player snapshots.

### Spotify Library/Search

The TypeScript application/Web API adapter is authoritative for newly fetched Web API data. SQLite is a cache, not an independent source of truth.

### UI State

Jotai/local React state is authoritative only for UI concerns such as selection, panel focus, modal state, and user preferences loaded from config.

## 7. Startup Sequence

```text
spotoei start
  │
  ├─ load config
  ├─ open/migrate cache
  ├─ render TUI shell immediately
  ├─ spawn spotoei-player
  │    └─ hello(protocol=1)
  ├─ handshake + capability check
  ├─ initialize auth state
  ├─ initialize/recover playback session
  └─ asynchronously refresh Home/library data
```

Initial TUI rendering MUST NOT wait for Spotify network requests.

## 8. Shutdown Sequence

On normal quit:

1. Stop accepting new UI commands.
2. Send `shutdown` command to player.
3. Allow a short bounded graceful shutdown.
4. Kill child if it does not exit within the bound.
5. Flush non-sensitive cache/config writes.
6. Restore terminal state.
7. Exit with appropriate code.

`Ctrl+C` MUST follow the same graceful path when possible.

## 9. Player Supervision

Unexpected sidecar exit:

```text
Running
  ↓ child exits
RecoveringPlayer
  ↓ restart with bounded backoff
Handshaking
  ↓
RestoringSession
  ├─ success → Running
  └─ repeated failure → PlayerUnavailable
```

Recommended MVP retry policy:

- immediate first restart;
- then approximately 1 s and 3 s delays;
- maximum 3 automatic restart attempts within a rolling 60-second window;
- after limit, require manual Retry.

The exact timer MAY be tuned, but infinite crash loops are prohibited.

## 10. Repository Layout

Recommended monorepo:

```text
spotoei/
├─ apps/
│  └─ tui/
│     └─ src/
│        ├─ presentation/
│        ├─ application/
│        ├─ domain/
│        └─ infrastructure/
├─ crates/
│  └─ player/
│     └─ src/
│        ├─ ipc/
│        ├─ application/
│        ├─ domain/
│        ├─ playback/
│        ├─ audio/
│        └─ auth/
├─ packages/
│  └─ protocol-schema/
├─ docs/
│  ├─ FSD.md
│  ├─ TSD/
│  └─ ADR/
├─ scripts/
├─ fixtures/
├─ package.json
├─ bun.lock
├─ Cargo.toml
└─ README.md
```

The exact folder names MAY vary, but architectural boundaries MUST remain visible in the filesystem.

## 11. Protocol Schema Ownership

The NDJSON protocol is defined once as a language-neutral schema/specification. TypeScript and Rust implementations MUST be validated against the same protocol fixtures.

Avoid code generation unless it clearly reduces drift without adding more build complexity than it removes. For MVP, shared JSON fixtures plus mirrored typed models are acceptable and simpler.

## 12. Error Model

Errors crossing architectural boundaries MUST be mapped to stable SPOTOEI error categories:

- `AUTH_REQUIRED`
- `AUTH_DENIED`
- `API_RATE_LIMITED`
- `API_QUOTA_EXCEEDED`
- `API_UNAVAILABLE`
- `PLAYER_UNAVAILABLE`
- `PLAYBACK_FAILED`
- `AUDIO_DEVICE_UNAVAILABLE`
- `LYRICS_UNAVAILABLE`
- `CACHE_UNAVAILABLE`
- `INVALID_REQUEST`
- `UNSUPPORTED`
- `INTERNAL`

Presentation code decides how these categories appear to the user; infrastructure-specific error strings MAY be retained only as redacted diagnostic detail.

## 13. Dependency Minimization

Prefer, in order:

1. language/runtime standard library;
2. Bun/Rust ecosystem primitive already brought in by a core dependency;
3. small well-maintained dependency with narrow purpose;
4. custom implementation only when the above are unsuitable.

A dependency MUST justify at least one of:

- substantial platform compatibility;
- security correctness;
- protocol correctness;
- non-trivial algorithmic correctness;
- meaningful maintenance reduction.

## 14. Architecture Fitness Checks

CI SHOULD include lightweight architecture checks such as:

- no Spotify HTTP adapter import from presentation directories;
- no infrastructure import from domain directories;
- no raw `process.stdout.write` from arbitrary UI modules;
- no direct librespot types in Rust IPC serialization structures.

These checks MAY begin as code-review rules and become automated if violations recur.
