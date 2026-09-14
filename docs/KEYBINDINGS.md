# Keybindings

SPOTOEI is keyboard-first. Press `?` (or `:`) anywhere to open the Command Palette, which
lists every command with its shortcut. Input fields (search, Client ID, palette) capture keys
so global shortcuts are not triggered while typing.

## Global

| Key                | Action                                                   |
| ------------------ | -------------------------------------------------------- |
| `q`, `Ctrl-C`      | Quit                                                     |
| `?`, `:`           | Open Command Palette                                     |
| `Tab`, `Shift-Tab` | Cycle focus (sidebar ↔ main; panels on Home/Search)      |
| `Esc`              | Close overlay, then step back through navigation history |
| `Ctrl-C`           | Quit (also cancels when an input is focused)             |

## Playback

| Key          | Action                                                  |
| ------------ | ------------------------------------------------------- |
| `Space`, `k` | Play / pause                                            |
| `n`          | Next track                                              |
| `p`          | Previous track                                          |
| `>` or `.`   | Seek forward 5 s                                        |
| `<` or `,`   | Seek backward 5 s                                       |
| `+` or `=`   | Volume +5%                                              |
| `-` or `_`   | Volume −5%                                              |
| `S`          | Toggle shuffle                                          |
| `R`          | Toggle repeat                                           |
| `A`          | Toggle autoplay (re-authenticate if a login is pending) |

## Navigation

| Key           | Action                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| `/`           | Search                                                                    |
| `r`           | Library (or refresh the active Home tab / Library section)                |
| `b`           | Browse                                                                    |
| `u`           | Queue                                                                     |
| `s`           | Settings                                                                  |
| `l`           | Toggle lyrics view                                                        |
| `L`           | Reload lyrics for the current track                                       |
| `v`           | Toggle full-screen visualizer                                             |
| `m`           | Cycle visualizer mode (spectrum → winamp → oscilloscope → circular → off) |
| `1`           | Home (For You)                                                            |
| `2`           | Browse                                                                    |
| `3`           | Search                                                                    |
| `4`           | Library (saved tracks)                                                    |
| `5`           | Queue                                                                     |
| `6`           | Lyrics                                                                    |
| `7`           | Settings                                                                  |
| `x`           | Context menu for the selected item                                        |
| `o`, `Ctrl-V` | Open a Spotify link/URI from the clipboard                                |
| `a`           | Authenticate / open the Spotify login flow                                |
| `Esc`         | Back, closing overlays first                                              |

## Vim motion

Counts work with motions, for example `5j`, `12G`, `3gg`.

| Key           | Action                                       |
| ------------- | -------------------------------------------- |
| `j`, `Down`   | Move down                                    |
| `k`, `Up`     | Move up                                      |
| `gg`, `g g`   | Jump to top                                  |
| `G`           | Jump to bottom                               |
| `PageDown`    | Down 5 items (10 lyric lines in Lyrics view) |
| `PageUp`      | Up 5 items (10 lyric lines in Lyrics view)   |
| `Home`, `End` | First / last item in search result lists     |

Digits also act as routes (`1`–`7`) when entered alone; the motion timeout is one second.

## Lists, entities, and browse

| Key                      | Action                                              |
| ------------------------ | --------------------------------------------------- |
| `Up` / `Down`, `j` / `k` | Move selection                                      |
| `Enter`                  | Open selected item (album, artist, playlist, track) |
| `PageUp` / `PageDown`    | Page through the list                               |

## Queue and Library

| Key                      | Action                             |
| ------------------------ | ---------------------------------- |
| `Up` / `Down`, `j` / `k` | Move selection                     |
| `Enter`                  | Jump to / open the item            |
| `r`                      | Refresh the active Library section |
| `Left`                   | Focus the sidebar                  |

## Search view

| Key                 | Action                                |
| ------------------- | ------------------------------------- |
| `/`                 | Focus the search input (from results) |
| `Enter`             | Submit / play the selected result     |
| `Down`, `j`         | Leave the input and focus results     |
| `Tab` / `Shift-Tab` | Cycle result panels                   |
| `Esc`               | Blur input / step back                |

## Lyrics view

| Key                                                                 | Action                               |
| ------------------------------------------------------------------- | ------------------------------------ |
| `j` / `k`, `Up` / `Down`                                            | Scroll lyrics (suspends auto-follow) |
| `r`, `R`, `Enter`                                                   | Resume auto-follow                   |
| Auto-follow resumes automatically ~5 s after the last manual scroll |

## Command Palette

| Key                      | Action               |
| ------------------------ | -------------------- |
| Type                     | Filter commands      |
| `Up` / `Down`, `j` / `k` | Move selection       |
| `Enter`                  | Run selected command |
| `Esc`, `Ctrl-C`          | Close                |

## Context menu

| Key                      | Action              |
| ------------------------ | ------------------- |
| `Up` / `Down`, `j` / `k` | Move selection      |
| `Enter`                  | Run selected action |
| `Esc`, `x`               | Close               |

## Onboarding / login

| Key                  | Action                                                    |
| -------------------- | --------------------------------------------------------- |
| `Enter`              | Focus the Client ID input, or log in if one is configured |
| `a`, `A`             | Start Spotify login                                       |
| `c`, `i`             | Edit the Client ID                                        |
| `d`                  | Restore the default Client ID                             |
| `Ctrl-D` (in input)  | Clear and restore the default Client ID                   |
| `L`, `Ctrl-L`        | Log out (when authenticated)                              |
| `Esc`, `Tab`, `Left` | Focus the sidebar                                         |

Playback controls are also available through MPRIS (Linux) and the OS media controls
(macOS/Windows), so keyboard shortcuts are not the only route.
