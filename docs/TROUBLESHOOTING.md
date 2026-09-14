# Troubleshooting

Start with:

```sh
spotoei doctor          # binary, audio, auth, database, paths
spotoei doctor auth     # all | audio | auth | network | db | system
```

Logs go to `<config dir>/spotoei.log` (see [CONFIGURATION.md](CONFIGURATION.md)); during
development `bun run dev:logs` tails them. Never paste tokens or full log files into public
issues.

## The app starts but playback fails

- **Spotify Premium is required.** librespot playback needs a Premium account; free accounts
  can browse but not stream locally.
- If the status bar says a login is pending, press `a` (or `A`) to re-authenticate.
- Confirm the player sidecar is present: `spotoei doctor` reports `player binary` and `audio
backend`.
- Check that no other exclusive audio client holds the device, then retry.

## "player binary not found"

SPOTOEI looks for `spotoei-player` next to the `spotoei` executable, then in `libexec/`, then
`target/debug|release` during development. Install both binaries from the same release, or
point at one explicitly:

```sh
SPOTOEI_PLAYER_BIN=/absolute/path/to/spotoei-player spotoei
```

## No sound on Linux

- `spotoei doctor audio` reports the backend state; the sidecar uses ALSA/PulseAudio.
- Select a device explicitly when the default is wrong:
  ```sh
  ALSA_CARD=1 ALSA_DEVICE=0 spotoei
  PULSE_SERVER=unix:/run/user/1000/pulse/native spotoei
  ```
- If the device mode is `Connect Only`, playback is delegated to another Spotify Connect
  device and nothing plays locally. Switch with the Command Palette command
  "Toggle Device Mode (Integrated/ConnectOnly)".

## Login browser does not open

SPOTOEI tries `xdg-open`, `sensible-browser`, or `wslview` (Linux), `open` (macOS), or
`rundll32` (Windows). If none is available, the authorization URL is printed to the terminal —
copy it into a browser manually. `spotoei authenticate` forces a fresh login.

## Login fails or the redirect is refused

- The redirect URI in the Spotify Developer Dashboard must exactly match what
  `spotoei doctor` prints, default `http://127.0.0.1:8989/login`. Spotify does not accept
  `localhost`; use the `127.0.0.1` literal.
- If port 8989 is busy, change it:
  ```sh
  spotoei config set-redirect-port 8990
  ```
  and add the matching `http://127.0.0.1:8990/login` (or `/callback`) URI to the dashboard.
- Verify the Client ID is 32 hex characters; `spotoei config set-client-id <id>` validates it.

## Credentials do not persist across restarts

- Persistent credentials live in the OS keyring (Secret Service/`gnome-keyring` on Linux,
  Keychain on macOS, Credential Manager on Windows). If the keyring is missing, the session is
  kept in memory only and you must log in again after restart.
- `SPOTOEI_AUTH_STORAGE=memory` (or mock mode) intentionally disables persistence.
- Logging out clears keyring tokens; log in again with `a`.

## API errors, missing data, or empty screens

- `401`: token expired or revoked — press `a` to re-authenticate.
- `403` / missing playlist or library data: the login may lack scopes — log out and log in
  again to grant the current scope set.
- `429` / quota: Spotify Development Mode quota is per Client ID. Back off, avoid repeated
  refreshes, and check `spotoei doctor`. SPOTOEI honors `Retry-After` and backs off
  automatically for short limits.

## Cache problems

- A corrupt cache is renamed (`cache.db.corrupt.<timestamp>`) and rebuilt automatically.
- Deleting the cache is always safe — it holds no credentials. Run
  `spotoei doctor db` to check integrity, or remove `<cache dir>/cache.db`.

## Cover art is missing or garbled

Cover-art rendering depends on the terminal. SPOTOEI auto-detects and falls back to text
blocks. Force a protocol if needed:

```sh
SPOTOEI_IMAGE_PROTOCOL=kitty spotoei     # or sixel, blocks, auto
```

## Terminal left in a broken state

SPOTOEI restores the terminal on normal exit and common failure paths. If a crash leaves the
terminal unusable, run `reset` (or `stty sane`) in that terminal and report the crash with the
log file attached (redact anything sensitive).

## Packaged release vs running from source

Release archives need no Bun, Node, Rust, or librespot installation. When running from source,
build the sidecar first (`cargo build -p spotoei-player`) or use `bun run dev`, which builds it
automatically.
