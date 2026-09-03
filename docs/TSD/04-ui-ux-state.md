# TSD 04 — UI, UX, and State Architecture

## 1. Stack

- React >= 19.2
- `@opentui/react`
- `@opentui/core`
- Jotai
- XState + `@xstate/react`
- Zod at infrastructure/config/protocol boundaries

## 2. UI Design Rule

SPOTOEI is keyboard-first but not Vim-first.

The interface must remain understandable through visible labels, focus, context actions, and Command Palette even if the user knows only arrow keys, Enter, Space, `/`, Esc, Tab, and `?`.

## 3. Component Topology

```text
<AppShell>
 ├─ <Sidebar />
 ├─ <MainRouter>
 │   ├─ <HomeView />
 │   ├─ <SearchView />
 │   ├─ <LibraryView />
 │   ├─ <PlaylistView />
 │   ├─ <AlbumView />
 │   ├─ <ArtistView />
 │   ├─ <NowPlayingView />
 │   └─ <LyricsView />
 ├─ <ContextPanel>
 │   ├─ <QueuePanel />
 │   ├─ <LyricsPanel />
 │   └─ <TrackInfoPanel />
 ├─ <NowPlayingBar />
 ├─ <CommandPalette />
 ├─ <ContextMenu />
 └─ <StatusLayer />
```

Do not create a monolithic `App.tsx` that owns all state and rendering.

## 4. State Categories

### 4.1 React Local State

Use for state that is:

- owned by one component/subtree;
- short-lived;
- not needed across screens.

Examples:

- local text input draft;
- temporary hover state;
- internal scroll calculation.

### 4.2 Jotai

Use for shared UI/domain projections that are not lifecycle machines.

Examples:

- active route/history;
- selected/focused entity;
- panel visibility/focus;
- queue projection from player snapshot;
- settings projection;
- library/search view data;
- current playback snapshot projection;
- lyrics document and manual-scroll/follow preference.

Jotai stores MUST NOT become a second playback engine. Playback atoms are projections of player events.

### 4.3 XState

Use only for event-driven lifecycle with constrained valid transitions.

Recommended machines:

- `appMachine`: booting → ready → degraded → shuttingDown;
- `authMachine`: unconfigured → authorizing → authenticated → refreshing → authError;
- `playerMachine`: absent → starting → handshaking → ready → recovering → unavailable.

A separate giant state machine for every screen is prohibited unless complexity proves it necessary.

### 4.4 High-Frequency Visualizer State

Visualizer frames DO NOT enter Jotai or XState.

Use a dedicated controller/store with latest-value semantics and an explicit subscription by the visualizer component.

## 5. Playback Projection

Player event:

```text
IPC → PlayerAdapter → PlaybackProjectionService → Jotai atoms → UI
```

Examples of projected atoms:

```ts
playbackAtom;
queueAtom;
currentTrackAtom;
playerAvailabilityAtom;
```

The projection service may interpolate position for display, but it must retain the last authoritative player timestamp/revision.

## 6. Navigation

Use explicit navigation history rather than routing by scattered booleans.

Conceptual model:

```ts
type Route =
  | { kind: 'home' }
  | { kind: 'search'; query?: string }
  | { kind: 'library'; section?: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'now-playing' }
  | { kind: 'lyrics' }
  | { kind: 'settings' };
```

`Esc` behavior:

1. close modal/overlay;
2. close transient context layer;
3. pop route history;
4. if at root, do nothing/brief hint rather than quit.

## 7. Focus System

Visible focus zones are registered in layout order.

Default wide order:

```text
Sidebar → Content → Context Panel → Sidebar
```

Focus border/indicator MUST be visible without depending only on color.

When a panel disappears because of resize, focus MUST move to a valid visible zone.

## 8. Responsive Layout

Implement layout capability rather than duplicating full screens for each width.

Suggested mode calculation:

```ts
if (cols >= 120) return 'wide';
if (cols >= 80) return 'medium';
return 'narrow';
```

Thresholds SHOULD be configurable constants and tested with representative terminal dimensions.

### Wide

Sidebar + content + context panel.

### Medium

Sidebar + content. Queue/Lyrics open as overlay or replaceable secondary panel.

### Narrow

One main panel; sidebar is a drawer; Now Playing bar reduces metadata and controls.

## 9. Command Palette

Command registry is centralized:

```ts
interface Command {
  id: string;
  title: string;
  shortcut?: KeyChord;
  group: string;
  isAvailable(ctx: CommandContext): boolean;
  run(ctx: CommandContext): Promise<void> | void;
}
```

Benefits:

- one source for palette labels and shortcuts;
- no duplicated keybinding business logic;
- context-sensitive availability;
- testable command behavior.

Keyboard handler SHOULD resolve key chords to command IDs rather than invoke use cases directly.

## 10. Default Commands

At minimum:

- navigation up/down/open/back;
- play/pause;
- next/previous;
- search;
- toggle like/save;
- add to queue;
- open queue;
- open lyrics;
- open Now Playing;
- toggle shuffle;
- cycle/toggle repeat;
- toggle autoplay;
- open settings;
- show command palette;
- quit.

## 11. Search UI

Search input:

- is globally opened with `/`;
- captures text until submit/escape;
- debounces remote requests;
- ignores stale responses using request sequence/cancellation;
- groups results by entity type;
- retains keyboard focus predictably as new results arrive.

Network results must not steal selection unexpectedly.

## 12. Track List Rendering

Create one reusable `TrackList` presentation primitive with configurable columns rather than separate near-duplicate lists for Album, Playlist, Search, and Library.

However, do not force all lists into one abstraction if entity semantics differ materially. DRY applies to duplicated knowledge, not every similar-looking component.

## 13. Now Playing Bar

The persistent bar subscribes to playback projection and visualizer controller independently.

It SHOULD not re-render all metadata at 60 FPS. Visualizer drawing must be isolated so only the visualizer region updates at high rate where OpenTUI permits.

## 14. Lyrics UX

### 14.1 Data Model

```ts
type LyricsDocument =
  | { kind: 'synced'; lines: TimedLyricLine[]; language?: string }
  | { kind: 'plain'; lines: PlainLyricLine[]; language?: string };
```

### 14.2 Synced Selection

Compute active line from playback position using binary search or monotonic cursor, not a full scan on every render.

### 14.3 Auto-Follow

State:

```text
auto-follow active
  ↓ user manually scrolls
auto-follow suspended
  ↓ explicit resume or inactivity timeout
auto-follow active
```

Recommended behavior:

- suspend follow immediately on manual scroll;
- show `Resume sync` hint;
- explicit key/action always resumes;
- optional automatic resume after ~5 seconds of no manual interaction MAY be enabled after usability testing.

### 14.4 Context vs Full View

Wide layout may show Lyrics in Context Panel. Full-screen Lyrics is always available for readability.

### 14.5 Missing Lyrics

Render a normal empty state. Never show stack traces/raw upstream error.

## 15. Visualizer Rendering

A `VisualizerController` owns:

- latest frame;
- requested mode;
- measured render timing;
- 60/30 FPS adaptation;
- subscription lifecycle.

The controller sends rate-change requests through `PlayerPort`.

No unbounded array of past frames is retained.

## 16. Error Presentation

Map `AppError` categories to presentation modes:

| Category             | Presentation                               |
| -------------------- | ------------------------------------------ |
| transient network    | status/banner                              |
| API quota            | status/banner with explanation             |
| lyrics unavailable   | inline empty state                         |
| player recovering    | persistent compact status                  |
| auth required        | blocking onboarding/account screen         |
| unrecoverable config | blocking actionable screen                 |
| internal unexpected  | compact error + diagnostic ID/log location |

Avoid modal dialogs for recoverable background errors.

## 17. Loading States

Never freeze the whole application for one panel's network request.

Use panel-local states:

```text
idle | loading | ready | stale-refreshing | error
```

Cached content can remain visible during `stale-refreshing`.

## 18. Mouse Support

Where OpenTUI/terminal support permits:

- click selects/opens rows;
- wheel scrolls current panel;
- click playback controls invokes the same command IDs as keyboard;
- no feature may be mouse-only.

## 19. Terminal Restore Safety

The TUI bootstrap must install bounded cleanup handlers for:

- normal exit;
- SIGINT/SIGTERM where supported;
- top-level uncaught error path.

Terminal cleanup logic lives in one module and is idempotent.

## 20. UI Testing

Required tests:

- command availability by context;
- keybinding → command mapping;
- focus traversal at wide/medium/narrow layouts;
- route history/Esc semantics;
- search stale-response handling;
- lyrics active-line calculation;
- manual-scroll auto-follow suspension;
- visualizer controller 60→30→60 hysteresis;
- error category → presentation mapping;
- Now Playing bar remains usable with visualizer off;
- snapshot/golden tests for critical text layouts where stable.
