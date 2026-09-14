# SPOTOEI — Install Guide

Packaged releases need no Bun, Node.js, Rust, or librespot installation.

## From a release archive

Download your platform's archive and `SHA256SUMS` from the
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
sha256sum -c SHA256SUMS

PREFIX=$HOME/.local
mkdir -p "$PREFIX/bin" "$PREFIX/libexec/spotoei"
tar -xzf spotoei-v0.0.0-linux-x86_64.tar.gz -C "$PREFIX/libexec/spotoei"
ln -sf "$PREFIX/libexec/spotoei/spotoei" "$PREFIX/bin/spotoei"
export PATH="$PREFIX/bin:$PATH"   # persist in ~/.bashrc or ~/.zshrc
```

For a system-wide install, use `PREFIX=/usr/local` with `sudo` for the `mkdir`, `tar`, and `ln`
commands.

### macOS

```sh
shasum -a 256 -c SHA256SUMS

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

## Configure the Spotify client

```sh
spotoei config set-client-id <your-32-hex-client-id>
```

Or export `SPOTOEI_CLIENT_ID` in your shell profile. Create the Client ID in the
[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and register the
redirect URI that `spotoei doctor` prints (default `http://127.0.0.1:8989/login`).

## First run

```sh
spotoei
```

The PKCE login flow opens your default browser. After authenticating you stay signed in until
you log out or clear the OS keyring entry.

## Verify install

```sh
spotoei doctor
```

Reports: version, sidecar, config, cache, browser, auth, audio backend, and paths.

## Uninstall

Linux/macOS:

```sh
rm -f "$HOME/.local/bin/spotoei"
rm -rf "$HOME/.local/libexec/spotoei"
rm -rf "$HOME/.cache/spotoei"   # cache only — leaves keyring credentials intact
```

Windows (PowerShell):

```powershell
Remove-Item "$env:LOCALAPPDATA\Programs\spotoei" -Recurse -Force
Remove-Item "$env:LOCALAPPDATA\spotoei" -Recurse -Force -ErrorAction SilentlyContinue # cache
Remove-Item "$env:APPDATA\spotoei" -Recurse -Force -ErrorAction SilentlyContinue      # config
```

The credential store lives in the OS keyring and is not removed by uninstall. Remove the
`spotoei` entries there if you want a clean removal.

## Build from source

```sh
bun install
bun run package
```

Outputs to `dist/`: `spotoei`, `spotoei-player`, a versioned `.tar.gz` archive, and
`SHA256SUMS`. Requires Bun ≥ 1.3, a Rust toolchain with `cargo`, and Linux ALSA/PulseAudio
development headers for the player build.
