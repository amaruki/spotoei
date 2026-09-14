# Assets

README previews, generated from the real TUI component tree by
`apps/tui/scripts/preview.ts`:

```sh
bun run apps/tui/scripts/preview.ts
```

Each scene builds `createUiCore` in a headless renderer (`@opentui/core/testing`), applies
fixture state from `previewData.ts`, and writes the captured frame spans to
`docs/assets/<scene>.svg` via `previewSvg.ts`. Regenerate the SVGs whenever the UI layout or
theme changes, and review the diff before committing.

Scenes: `home`, `search`, `library`, `queue`, `lyrics`, `visualizer`, `palette`.

To record a live demo instead, use `asciinema` + `agg`:

```sh
asciinema rec demo.cast
agg --theme monokai demo.cast docs/assets/demo.gif
```

Do not include tokens, Client IDs, account names, or other personal data in captures.
