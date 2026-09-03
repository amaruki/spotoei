# TSD 08 — Packaging, Installation, and Release

## 1. User-Facing Goal

Users install SPOTOEI once and run:

```text
spotoei
```

They do not manually manage the Rust player sidecar.

## 2. MVP Packaging Model

Ship two project executables in one installation package:

```text
bin/
├─ spotoei
└─ spotoei-player
```

`spotoei` locates `spotoei-player` relative to its installation path or package-specific libexec path.

The sidecar is an implementation detail.

Rationale:

- simpler build/debug/signing model than embedding/extracting a second platform binary;
- no temporary executable extraction security/lifecycle concerns;
- easier independent crash diagnosis;
- still one user command.

A future single-file package MAY embed the sidecar only after the MVP is stable and there is demonstrated user value.

## 3. TypeScript Build

Use Bun standalone compilation for the TUI.

OpenTUI supports bundling its native assets into Bun standalone executables. Release build MUST explicitly target the intended platform/architecture/libc and include matching OpenTUI native packages.

Example conceptual command:

```text
bun build --compile apps/tui/src/main.tsx --outfile dist/spotoei
```

Production build scripts SHOULD be code rather than ad-hoc shell when target-specific configuration becomes non-trivial.

## 4. Rust Build

Use locked Cargo dependencies and release profile.

Requirements:

- `Cargo.lock` committed for application reproducibility;
- exact librespot resolved version/revision recorded;
- strip symbols where appropriate but preserve separately downloadable debug symbols if feasible;
- panic strategy selected deliberately after validating cleanup behavior;
- platform signing/notarization applied where required.

## 5. Target Matrix

Initial recommended priority:

| Priority | Target                                                        |
| -------- | ------------------------------------------------------------- |
| P0       | Linux x86_64 glibc                                            |
| P0       | macOS arm64                                                   |
| P0       | Windows x86_64                                                |
| P1       | Linux arm64 glibc                                             |
| P1       | macOS x86_64                                                  |
| P1       | Linux x86_64 musl if audio/keyring compatibility is validated |
| P2       | Windows arm64                                                 |

Do not advertise a target until audio output, keyring, OAuth browser flow, and OpenTUI rendering are tested on it.

## 6. Linux Audio Packaging

librespot's default Rodio backend uses CPAL and Linux builds may require ALSA development libraries at build time.

Release artifacts MUST be built on controlled CI images. End users SHOULD require only normal runtime libraries provided by supported distributions, not `*-dev` packages or a compiler.

If truly portable Linux packaging proves difficult due to audio/keyring ABI expectations, prefer clearly documented distro/package builds over brittle universal binaries.

## 7. Package Layout

Preferred:

### Unix-like

```text
/usr/local/bin/spotoei
/usr/local/libexec/spotoei/spotoei-player
```

or package-manager-equivalent paths.

### Windows

Both executables may live in one application directory with `spotoei.exe` on PATH.

The locator MUST not search arbitrary current-working-directory executables before the trusted installed sidecar location.

## 8. Distribution Channels

Order of implementation:

1. Release archives + checksums.
2. Generic installer script for supported Linux/macOS paths.
3. Homebrew formula/tap.
4. AUR package.
5. Scoop/WinGet manifest as appropriate.

Package manager availability is not a blocker for the first MVP release if signed/checksummed release artifacts are easy to install.

## 9. Installer Script

If provided, installer MUST:

- detect OS/architecture;
- download a versioned artifact over HTTPS;
- verify checksum before install;
- install both binaries atomically where practical;
- never execute downloaded content before verification;
- explain PATH changes;
- support uninstall instructions.

Avoid `curl | sh` as the only documented installation path. If offered for convenience, documentation SHOULD also show a verify-before-execute method.

## 10. Signing and Checksums

Each release SHOULD publish SHA-256 checksums.

Platform signing:

- macOS: code signing/notarization when project resources permit;
- Windows: Authenticode when feasible;
- Linux: signed release metadata/checksums when feasible.

Do not block early development builds on paid signing infrastructure, but stable releases SHOULD move toward platform trust mechanisms.

## 11. Versioning

Use Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Pre-1.0 versions may make breaking config/protocol changes, but changes MUST still be documented and migrations supplied where user data would otherwise break.

The sidecar and UI are released as one SPOTOEI version. Independent user-facing sidecar version management is not supported.

## 12. IPC Compatibility in Packaging

At startup, UI/sidecar handshake verifies protocol major and reports an actionable error if mismatched.

Package install/update MUST update both executables together.

## 13. Update Strategy

MVP does NOT require an in-app self-updater.

Preferred behavior:

- package manager users update through package manager;
- archive users manually replace the package;
- SPOTOEI MAY check for a newer version only if implemented with explicit user control and without mandatory telemetry.

KISS favors no self-updater initially.

## 14. `spotoei doctor`

`doctor` runs without starting full TUI where possible.

Checks:

```text
[ok] SPOTOEI version
[ok] player sidecar found and protocol compatible
[ok] config readable
[ok] cache database integrity
[ok] credential store available
[ok] browser launch mechanism available
[ok] audio backend/device detected
[ok] Spotify Client ID configured
[--] authentication status (redacted)
```

Network checks SHOULD be optional so `doctor` remains useful offline.

Exit code SHOULD indicate whether a blocking problem was found.

## 15. Build Reproducibility

CI MUST use:

- locked Bun dependencies;
- locked Cargo dependencies;
- pinned build image/toolchain versions for stable releases;
- scripted artifact naming;
- automated checksum generation;
- automated smoke tests against packaged artifacts.

## 16. Artifact Naming

Example:

```text
spotoei-v0.1.0-linux-x86_64.tar.gz
spotoei-v0.1.0-linux-aarch64.tar.gz
spotoei-v0.1.0-macos-arm64.tar.gz
spotoei-v0.1.0-windows-x86_64.zip
SHA256SUMS
```

Archive contains license, brief README, `spotoei`, and `spotoei-player`.

## 17. Release Smoke Test

For every advertised platform:

1. extract/install on clean environment;
2. run `spotoei --version`;
3. run `spotoei doctor`;
4. start TUI with fake/offline mode or controlled fixture;
5. verify sidecar handshake;
6. verify terminal cleanup;
7. where credentials are available in secure CI/manual environment, perform a manual playback smoke test.

## 18. Rollback

Because user cache schema may migrate, releases MUST document whether downgrade is supported.

Cache is reconstructable, so if a downgrade encounters a newer incompatible cache, SPOTOEI MAY offer to rebuild cache rather than implement complex backward migrations.

Credentials remain in keyring and must not be deleted by routine downgrade/cache rebuild.
