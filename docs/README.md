# SPOTOEI Documentation

SPOTOEI is a keyboard-first, terminal-native Spotify client.

**The code is the source of truth.** The specifications in `TSD/` describe the intended
architecture and the constraints the implementation was built against. The implementation
may have diverged in places (for example, the UI is built directly on `@opentui/core`
without React/Jotai/XState, and module layout has evolved). When a document and the code
disagree, the code wins; report or fix stale documentation.

## Getting started

- [`../README.md`](../README.md) — project overview, install, usage.
- [`INSTALL.md`](INSTALL.md) — installation, first run, uninstall.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — development setup, commands, debugging.
- [`CONFIGURATION.md`](CONFIGURATION.md) — config file, paths, environment variables.
- [`KEYBINDINGS.md`](KEYBINDINGS.md) — keyboard reference.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — common problems and fixes.

## Technical specifications

- [`TSD/00-index.md`](TSD/00-index.md) — index, locked decisions, dependency baseline.
- [`TSD/01-system-architecture.md`](TSD/01-system-architecture.md) — process/layer architecture.
- [`TSD/02-auth-spotify-api.md`](TSD/02-auth-spotify-api.md) — authentication and Spotify Web API.
- [`TSD/03-playback-audio-visualizer.md`](TSD/03-playback-audio-visualizer.md) — playback, audio, visualizer.
- [`TSD/04-ui-ux-state.md`](TSD/04-ui-ux-state.md) — UI/UX and state architecture.
- [`TSD/05-data-cache-config.md`](TSD/05-data-cache-config.md) — SQLite cache/config/local storage.
- [`TSD/06-ipc-contract.md`](TSD/06-ipc-contract.md) — NDJSON protocol.
- [`TSD/07-testing-observability.md`](TSD/07-testing-observability.md) — tests, reliability, local observability.
- [`TSD/08-packaging-release.md`](TSD/08-packaging-release.md) — packaging and installation.
- [`TSD/09-coding-standards.md`](TSD/09-coding-standards.md) — Clean Architecture, Clean Code, KISS, DRY and language rules.

Baseline date: 2026-09-02.
