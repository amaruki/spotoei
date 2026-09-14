# Contributing

Thanks for helping improve SPOTOEI. This project is an unofficial Spotify client; keep changes
consistent with the architecture and constraints documented in
[`docs/TSD/01-system-architecture.md`](docs/TSD/01-system-architecture.md) and
[`docs/TSD/09-coding-standards.md`](docs/TSD/09-coding-standards.md).

## Before you start

- Search existing issues and pull requests first; open an issue for non-trivial changes.
- Keep one logical change per pull request.
- Never commit real tokens, Client IDs, or log files containing credentials.

## Setup

Prerequisites, repository layout, mock mode, and debugging instructions live in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). The short version:

```sh
bun install
cargo build -p spotoei-player
bun run dev
```

## Making changes

- Respect the architecture boundaries in [`docs/TSD/01-system-architecture.md`](docs/TSD/01-system-architecture.md):
  UI modules must not import Spotify HTTP payloads or raw librespot types.
- Keep every production file under **300 LoC**; `bun run lint` enforces this.
- Add or update tests for behavior changes. Fakes are preferred over live Spotify calls.
- Update docs when behavior, configuration, or the IPC protocol changes (`docs/` and
  `packages/protocol/`).
- Bump the protocol version for wire-format changes.

## Checks

Run these before opening a pull request; CI runs the same set:

```sh
bun run lint
bun run format:check
bun run typecheck
bun test

cargo fmt --all --check
cargo clippy --all-targets
cargo test -p spotoei-player
```

## Commits and branches

Use [Conventional Commits](https://www.conventionalcommits.org/) with a scope where it helps:

```text
feat(playback): add gapless preloading
fix(auth): keep token cache consistent after logout
perf(visualizer): skip FFT work when mode is off
refactor(player): split auth into focused modules
docs(tsd): document cache migration policy
test(ipc): add unsupported-version fixture
```

Refactors that split an oversized file must be a single atomic commit. Keep commits coherent
and buildable where practical.

## Pull request checklist

A pull request is ready when applicable:

- [ ] architecture boundaries respected;
- [ ] no unnecessary dependency added;
- [ ] errors mapped and secrets redacted;
- [ ] tests added or updated;
- [ ] protocol/config migration handled;
- [ ] focus and keyboard behavior considered for UI changes;
- [ ] performance considered for hot paths;
- [ ] logs contain no secrets;
- [ ] docs updated for behavioral or architectural changes;
- [ ] formatter, linter, type checks, and tests pass.

## Releasing

The `Release` workflow builds archives for Linux (x86_64, arm64), macOS (arm64, x86_64), and
Windows (x86_64), then publishes a GitHub release with a combined `SHA256SUMS`.

Trigger it by:

1. **Version bump on main** — update `version` in `package.json`, commit, push to `main`.
2. **Tag** — `git tag v<version> && git push origin v<version>`.
3. **Manual** — Actions → Release → Run workflow (set `dry_run` to build without publishing).

The tag, the workflow input, and `package.json` must all carry the same version; the workflow
fails on mismatch. Version bump commits are skipped automatically when the version did not
change.

## Reporting bugs

Open a GitHub issue with the platform, terminal, SPOTOEI version (`spotoei --version`), steps to
reproduce, and `spotoei doctor` output. Redact tokens, Client IDs, and personal data. Security
issues should follow [`SECURITY.md`](SECURITY.md) instead of the public tracker.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
