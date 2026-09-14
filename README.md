# SPOTOEI

A keyboard-first, terminal-native Spotify client with a Winamp-inspired visualizer, synced
lyrics, and local playback through [librespot](https://github.com/librespot-org/librespot).

![SPOTOEI terminal UI](docs/assets/demo.svg)

> Unofficial project. Not affiliated with, endorsed by, or sponsored by Spotify. Spotify is a
> trademark of Spotify AB. A Spotify Premium account is required for playback.

## Features

- **Local playback** via a bundled Rust/librespot sidecar — no official client needed.
- **Keyboard-first TUI** built on [OpenTUI](https://opentui.com): vim motions, command palette, context menus.
- **Visualizer**: spectrum, Winamp-style bars, oscilloscope, and circular modes driven by the decoded PCM stream.
- **Synced lyrics** with plain-text fallback.
- **Search, library, playlists, albums, artists, queue, and Home** tabs.
- **Cover art** in terminals that support kitty/sixel graphics (text-block fallback elsewhere).
- **OS media controls**: MPRIS on Linux, media keys on macOS/Windows.
- **Privacy by default**: credentials live in the OS keyring, never in config or cache.

## Requirements

- Spotify **Premium** account
- A terminal with modern Unicode support
- An audio output device (for local playback)
- A browser for the OAuth login
- Your own Spotify Developer application Client ID (see [Configuration](docs/CONFIGURATION.md))

Packaged releases need no Bun, Node.js, Rust, or librespot installation.

## Install

Download the archive for your platform and `SHA256SUMS` from the
[latest release](https://github.com/amaruki/spotoei/releases/latest). Each archive contains
`spotoei`, `spotoei-player`, `LICENSE`, and `README.md`.

| Platform | Architecture  | Archive                                |
| -------- | ------------- | -------------------------------------- |
| Linux    | x86_64        | `spotoei-v0.0.0-linux-x86_64.tar.gz`   |
| Linux    | arm64         | `spotoei-v0.0.0-linux-arm64.tar.gz`    |
| macOS    | Apple silicon | `spotoei-v0.0.0-macos-arm64.tar.gz`    |
| macOS    | Intel         | `spotoei-v0.0.0-macos-x86_64.tar.gz`   |
| Windows  | x86_64        | `spotoei-v0.0.0-windows-x86_64.tar.gz` |
| Windows  | arm64         | `spotoei-v0.0.0-windows-arm64.tar.gz`  |

### Linux

Runtime packages: `alsa-lib` and `libpulse` (Debian/Ubuntu: `libasound2 libpulse0`, Fedora:
`alsa-lib pulseaudio-libs`, Arch: `alsa-lib libpulse`).

```sh
# Verify the download
sha256sum -c SHA256SUMS

# Per-user install (no root)
PREFIX=$HOME/.local
mkdir -p "$PREFIX/bin" "$PREFIX/libexec/spotoei"
tar -xzf spotoei-v0.0.0-linux-x86_64.tar.gz -C "$PREFIX/libexec/spotoei"
ln -sf "$PREFIX/libexec/spotoei/spotoei" "$PREFIX/bin/spotoei"

# Make sure $PREFIX/bin is on PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$PREFIX/bin:$PATH"
```

For a system-wide install, use `PREFIX=/usr/local` with `sudo` for the `mkdir`, `tar`, and `ln`
commands.

### macOS

```sh
# Verify the download
shasum -a 256 -c SHA256SUMS

# Per-user install (no sudo)
PREFIX=$HOME/.local
mkdir -p "$PREFIX/bin" "$PREFIX/libexec/spotoei"
tar -xzf spotoei-v0.0.0-macos-arm64.tar.gz -C "$PREFIX/libexec/spotoei"
ln -sf "$PREFIX/libexec/spotoei/spotoei" "$PREFIX/bin/spotoei"

# If Gatekeeper blocks the binaries
xattr -dr com.apple.quarantine "$PREFIX/libexec/spotoei"
```

Add `$PREFIX/bin` to your `PATH` (for example in `~/.zshrc`).

### Windows

Run in PowerShell; the built-in `tar` (Windows 10 1803+) extracts the archive.

```powershell
# Verify: compare with the value in SHA256SUMS
Get-FileHash .\spotoei-v0.0.0-windows-x86_64.tar.gz -Algorithm SHA256

$dest = "$env:LOCALAPPDATA\Programs\spotoei"
New-Item -ItemType Directory -Force $dest | Out-Null
tar -xzf .\spotoei-v0.0.0-windows-x86_64.tar.gz -C $dest
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$dest", "User")
```

Open a new terminal so the updated `PATH` takes effect.

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide, including uninstall and build from
source.

## Run

```sh
spotoei
```

The first run walks through the Spotify Client ID and the PKCE login flow in your browser.
Verify the setup any time with `spotoei doctor`.

### Keys

| Key           | Action                         |
| ------------- | ------------------------------ |
| `?` / `:`     | Command palette                |
| `Space` / `k` | Play / pause                   |
| `n` / `p`     | Next / previous                |
| `/`           | Search                         |
| `r`           | Library                        |
| `u`           | Queue                          |
| `l` / `L`     | Lyrics view / reload lyrics    |
| `v` / `m`     | Visualizer toggle / cycle mode |
| `1`–`7`       | Jump between main views        |
| `Tab`         | Switch focus                   |
| `Esc`         | Back                           |
| `q`           | Quit                           |

Full reference: [docs/KEYBINDINGS.md](docs/KEYBINDINGS.md).

### CLI

```sh
spotoei search <query>                  # non-interactive search
spotoei authenticate                    # force fresh logins
spotoei doctor [check]                  # verify binary, audio, auth, database
spotoei config set-client-id <id>
spotoei config set-redirect-port <port>
```

## Build from source

Requires [Bun](https://bun.sh) ≥ 1.3 and a Rust toolchain ≥ 1.80. On Linux, install ALSA and
PulseAudio development headers first (`libasound2-dev libpulse-dev pkg-config` on Debian/Ubuntu).

```sh
bun install
bun run dev        # builds the Rust sidecar and starts the TUI
```

Other commands:

```sh
bun run start      # run against an already-built sidecar
bun test           # TypeScript tests (also: cargo test -p spotoei-player)
bun run lint       # oxlint + 300 LoC check
bun run typecheck
bun run package    # build both binaries into dist/
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for details.

## Documentation

- [Install guide](docs/INSTALL.md)
- [Configuration](docs/CONFIGURATION.md)
- [Keybindings](docs/KEYBINDINGS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Development](docs/DEVELOPMENT.md)
- [Technical specifications](docs/TSD/00-index.md) and [documentation index](docs/README.md)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
Security reports: [SECURITY.md](SECURITY.md). Community expectations:
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 SPOTOEI contributors.
