# SPOTOEI — Install Guide

## From release archive

Download the tarball and `SHA256SUMS` from the latest release on GitHub.

```sh
# Verify
sha256sum -c SHA256SUMS

# Extract into a prefix of your choice (avoid running as root unless needed)
PREFIX=$HOME/.local
mkdir -p "$PREFIX/bin" "$PREFIX/libexec/spotoei"
tar -xzf spotoei-v0.0.0-linux-x64.tar.gz -C "$PREFIX/libexec/spotoei"
ln -sf "$PREFIX/libexec/spotoei/spotoei" "$PREFIX/bin/spotoei"
```

Add `$PREFIX/bin` to your `PATH` (and restart your shell) so `spotoei` resolves.

System install (Linux/macOS, root):

```sh
tar -xzf spotoei-v0.0.0-linux-x64.tar.gz -C /usr/local/libexec/spotoei
ln -sf /usr/local/libexec/spotoei/spotoei /usr/local/bin/spotoei
ln -sf /usr/local/libexec/spotoei/spotoei-player /usr/local/libexec/spotoei/spotoei-player
```

## Configure Spotify client

```sh
export SPOTOEI_CLIENT_ID=<your-spotify-client-id>
```

Persist this in your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) so future invocations pick it up.

## First run

```sh
spotoei
```

The PKCE login flow opens your default browser. After authenticating, you stay signed in until you log out or rotate the keyring.

## Verify install

```sh
spotoei doctor
```

Reports: version, sidecar, config, cache, browser, auth, audio backend status.

## Uninstall

```sh
rm -f /usr/local/bin/spotoei
rm -rf /usr/local/libexec/spotoei
rm -rf ~/.cache/spotoei    # cache only — leaves keyring credentials intact
```

The credential store lives in your OS keyring and is not removed by uninstall.

## Build from source

```sh
bun install
bun run package
```

Outputs to `dist/`. Requires Bun ≥ 1.3, Rust toolchain with `cargo`, and Linux ALSA development libraries for the player build.
