# Development

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- Rust toolchain >= 1.80 (`cargo`, `rustfmt`, `clippy`)
- Linux audio development headers for the player build:
  - Debian/Ubuntu: `sudo apt install libasound2-dev libpulse-dev pkg-config`
  - Fedora: `sudo dnf install alsa-lib-devel pulseaudio-libs-devel pkgconf-pkg-config`
- A Spotify account for live playback testing. Packaging and mock mode do not need one.

## Repository layout

```text
apps/tui/            TypeScript TUI (Bun + @opentui/core)
  src/main/          entrypoint, CLI, wiring, lifecycle
  src/ui/            OpenTUI component tree, views, core controller
  src/browse/        home tabs and browse state
  src/webApi/        Spotify Web API adapter
  src/cache/         bun:sqlite cache + stale-while-revalidate
  src/player/        sidecar supervision, handshake, NDJSON readline
  test/              bun tests
crates/player/       Rust sidecar (librespot playback core)
  src/dispatcher/    IPC command dispatch
  src/playback/      engine, librespot adapters, state
  src/auth/          PKCE, token storage, OS keyring
  src/media/         MPRIS / OS media controls
  src/visualizer/    FFT analysis
packages/protocol/   versioned IPC schemas and fixtures
scripts/             dev, logs, packaging, LoC check, test setup
docs/                TSD plus user/developer guides
```

Architecture constraints are documented in `docs/TSD/01-system-architecture.md`.

## Setup

```sh
bun install
cargo build -p spotoei-player
```

## Run

```sh
bun run dev        # builds the Rust debug sidecar, then starts the TUI
bun run start      # starts the TUI against an already-built sidecar
bun run dev:logs   # tail the dev log
```

`bun run dev` sets `SPOTOEI_PLAYER_BIN` to `target/debug/spotoei-player` and writes logs to
`target/dev/spotoei.log`. Add `.env` or `.env.local` in the repository root with
`SPOTOEI_CLIENT_ID=<your-client-id>` to avoid exporting it in every shell; see
[CONFIGURATION.md](CONFIGURATION.md).

## Tests

```sh
bun test                          # TypeScript (protocol + tui)
bun test apps/tui/test/queue.test.ts
cargo test -p spotoei-player      # Rust
```

The bun preload in `scripts/testSetup.ts` redirects config/cache paths into a temp directory and
uses in-memory auth storage, so tests never touch a developer session.

## Lint, format, and type checks

```sh
bun run lint          # oxlint + 300 LoC limit check
bun run format        # oxfmt
bun run format:check
bun run typecheck     # tsc --noEmit (spotoei-tui)
cargo fmt --all
cargo clippy --all-targets
```

Every production file must stay under 300 LoC (`scripts/check-loc.ts`). Coding rules live in
`docs/TSD/09-coding-standards.md`.

## Mock mode

Run without Spotify credentials or audio hardware:

```sh
SPOTOEI_MOCK_PLAYER=1 bun run start
```

Mock mode swaps the librespot engine for the fake engine, mocks auth, and uses an in-memory
credential store. Related variables:

| Variable                                     | Effect                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `SPOTOEI_MOCK_PLAYER`                        | Fake playback engine plus mock auth                    |
| `SPOTOEI_MOCK_AUTH`                          | Mock auth only (also skips real playback engine)       |
| `SPOTOEI_AUTH_STORAGE=memory`                | Keep credentials in memory; never touch the OS keyring |
| `SPOTOEI_DEVICE_MODE`, `SPOTOEI_DEVICE_NAME` | Override the reported Connect device                   |
| `SPOTOEI_LOG_STDERR_ONLY`                    | Log to stderr instead of the log file                  |

## Protocol

The TypeScript and Rust sides share the versioned NDJSON protocol defined in
`packages/protocol/`. Fixtures live in `packages/protocol/fixtures/`; protocol tests are in
`packages/protocol/test/` and `apps/tui/test/player.test.ts`. The contract is documented in
`docs/TSD/06-ipc-contract.md`. Bump the protocol version when the wire format changes.

## Packaging

```sh
bun run package       # builds both binaries into dist/
```

Outputs `dist/spotoei` (compiled Bun binary), `dist/spotoei-player` (Rust release), the
versioned tarball, and `SHA256SUMS`. See `docs/TSD/08-packaging-release.md` and
[INSTALL.md](INSTALL.md).

## Data during development

Config, cache, and logs default to platform paths; see [CONFIGURATION.md](CONFIGURATION.md).
To keep a dev session separate from your real one:

```sh
SPOTOEI_CONFIG_DIR=/tmp/spotoei-dev SPOTOEI_CACHE_DIR=/tmp/spotoei-dev bun run start
```

## Continuous integration

`.github/workflows/ci.yml` runs lint/typecheck/format/tests/build for TypeScript and
fmt/clippy/tests for Rust.
