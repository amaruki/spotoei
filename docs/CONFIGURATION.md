# Configuration

SPOTOEI keeps user configuration in a single `config.json` and stores everything else
(cache, logs, credentials) outside that file. Credentials live in the OS keyring, never in
`config.json`.

## File locations

| Data   | Location                                                                     |
| ------ | ---------------------------------------------------------------------------- |
| Config | `$SPOTOEI_CONFIG_DIR/config.json`, else XDG/macOS/Windows config dir (below) |
| Cache  | `$SPOTOEI_CACHE_DIR/cache.db`, else XDG/macOS/Windows cache dir              |
| Log    | `$SPOTOEI_LOG_FILE`, else `<config dir>/spotoei.log`                         |

Platform defaults:

| Platform | Config dir                                        | Cache dir                                       |
| -------- | ------------------------------------------------- | ----------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/spotoei` or `~/.config/spotoei` | `$XDG_CACHE_HOME/spotoei` or `~/.cache/spotoei` |
| macOS    | `~/Library/Application Support/spotoei`           | `~/Library/Caches/spotoei`                      |
| Windows  | `%APPDATA%\spotoei`                               | `%LOCALAPPDATA%\spotoei`                        |

## Spotify Client ID

SPOTOEI needs a Spotify Developer application Client ID. Resolution order:

1. `SPOTOEI_CLIENT_ID` environment variable;
2. `SPOTOEI_CLIENT_ID` from `.env.local` or `.env` in the current working directory;
3. `spotify.clientId` in `config.json`;
4. the built-in default Client ID.

Create your own application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
and add the redirect URI shown by `spotoei doctor` (default
`http://127.0.0.1:8989/login`). The Client ID is not a secret; the PKCE flow does not use a
Client Secret.

Set it once:

```sh
spotoei config set-client-id <32-hex-client-id>
```

or export it:

```sh
export SPOTOEI_CLIENT_ID=<32-hex-client-id>
```

## `config.json`

```json
{
  "version": 1,
  "spotify": {
    "clientId": "0123456789abcdef0123456789abcdef",
    "redirectPort": 8989
  },
  "playback": {
    "volume": 0.8,
    "autoplay": true
  },
  "browse": {
    "charts": [],
    "editorialPlaylists": [],
    "drivingPlaylistUris": []
  }
}
```

| Field                  | Meaning                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `version`              | Config schema version                                                              |
| `spotify.clientId`     | Spotify Developer application Client ID                                            |
| `spotify.redirectPort` | OAuth loopback redirect port (default `8989`)                                      |
| `playback.volume`      | Initial volume (0.0–1.0)                                                           |
| `playback.autoplay`    | Autoplay similar tracks when the queue ends                                        |
| `browse`               | Browse/charts configuration validated at load; empty arrays disable those sections |

Malformed config files are rejected and defaults are used instead. Tokens must never be
placed in this file.

## Environment variables

| Variable                                              | Purpose                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `SPOTOEI_CLIENT_ID`                                   | Spotify Client ID (overrides config)                              |
| `SPOTOEI_REDIRECT_PORT`                               | OAuth loopback port (overrides config)                            |
| `SPOTOEI_CONFIG_DIR`                                  | Config directory override                                         |
| `SPOTOEI_CACHE_DIR`                                   | Cache directory override                                          |
| `SPOTOEI_CACHE_FILE`                                  | Full cache database path override                                 |
| `SPOTOEI_LOG_FILE`                                    | Log file path override                                            |
| `SPOTOEI_LOG_STDERR_ONLY`                             | Log to stderr instead of the log file                             |
| `SPOTOEI_IMAGE_PROTOCOL`                              | Cover-art rendering: `auto` (default), `kitty`, `sixel`, `blocks` |
| `SPOTOEI_PLAYER_BIN`                                  | Absolute path to the `spotoei-player` binary                      |
| `SPOTOEI_MOCK_PLAYER` / `SPOTOEI_MOCK_AUTH`           | Fake playback/auth for development                                |
| `SPOTOEI_AUTH_STORAGE=memory`                         | Keep credentials in memory only                                   |
| `SPOTOEI_DEVICE_MODE` / `SPOTOEI_DEVICE_NAME`         | Override the reported Connect device                              |
| `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` | Standard XDG overrides                                            |
| `ALSA_CARD`, `ALSA_DEVICE`                            | Linux ALSA device selection                                       |
| `PULSE_SERVER`, `PIPEWIRE_RUNTIME_DIR`                | Linux audio server selection                                      |
| `RUST_LOG`                                            | Sidecar log level (default `info`)                                |

Only a safe allowlist of variables is forwarded to the `spotoei-player` sidecar; anything
that looks secret (for example `*_TOKEN` or `SPOTOEI_CLIENT_SECRET`) is dropped.

## Commands

```sh
spotoei doctor                    # verify binary, audio, auth, database, paths
spotoei doctor auth               # single check: all|audio|auth|network|db|system
spotoei config set-client-id <id>
spotoei config set-redirect-port <port>
```
