# TSD 09 — Coding Standards and Engineering Rules

## 1. Purpose

These rules are normative for SPOTOEI implementation and code review. They operationalize Clean Code, Clean Architecture, KISS, and DRY without turning them into dogma.

## 2. Priority

When rules conflict:

1. correctness/security;
2. clarity;
3. simplicity;
4. testability;
5. performance where measured/required;
6. abstraction reuse.

## 3. KISS

Prefer the smallest design that satisfies current requirements.

Examples:

- NDJSON stdin/stdout instead of a daemon/socket protocol for MVP;
- two packaged executables instead of executable self-extraction;
- built-in `fetch` instead of Axios;
- `bun:sqlite` instead of an ORM;
- explicit processor chain instead of DSP plugin framework;
- package-manager/manual updates instead of self-updater.

Do not add extension points for hypothetical features unless a current boundary already requires one.

## 4. DRY

DRY means one authoritative representation of knowledge/policy.

Good DRY targets:

- command registry;
- keybinding definitions;
- Spotify endpoint construction;
- cache-key builders;
- error-code mapping;
- IPC message schemas;
- platform path resolution.

Do NOT merge code solely because lines look similar. Two small components with different semantics are preferable to one highly parameterized abstraction with branches everywhere.

Rule of thumb: tolerate two occurrences; abstract when the shared concept is proven and a third occurrence or bug-prone policy duplication appears.

## 5. Clean Architecture

Domain/application layers MUST NOT import infrastructure implementations.

Ports/interfaces live near the code that consumes them, not automatically in a giant global `interfaces/` folder.

Infrastructure adapters are replaceable and map external types at the boundary.

## 6. Module Size and Cohesion

There is no rigid line-count limit, but modules SHOULD have one clear reason to change.

Warning signs requiring refactor:

- file contains unrelated auth + UI + cache logic;
- function accepts many boolean flags;
- function name includes `and` for multiple responsibilities;
- component performs networking, mapping, state mutation, and rendering;
- tests require mocking many unrelated systems.

## 7. Functions

Prefer:

- explicit inputs/outputs;
- early returns for invalid/exceptional cases;
- small orchestration functions calling named operations;
- pure functions for mapping/calculation;
- no hidden mutation of unrelated global state.

Avoid arbitrary micro-functions that make linear logic harder to follow.

## 8. Naming

Names describe intent, not implementation accidents.

### TypeScript

- types/interfaces/components: `PascalCase`;
- functions/variables: `camelCase`;
- constants: `UPPER_SNAKE_CASE` only for true constants, otherwise normal camelCase;
- atoms: suffix `Atom`;
- XState machines: suffix `Machine`;
- ports: suffix `Port`;
- concrete infrastructure adapters: suffix `Adapter` or domain-specific name.

### Rust

Follow standard Rust naming:

- types/traits: `PascalCase`;
- functions/modules/variables: `snake_case`;
- constants: `SCREAMING_SNAKE_CASE`.

Do not prefix interfaces/traits with `I`.

## 9. TypeScript Rules

### Compiler

Use strict TypeScript configuration.

Enable/retain strong checks such as:

- `strict`;
- no unchecked assumptions around optional/indexed data where practical;
- explicit module boundaries.

Avoid `any`. If external data is unknown, use `unknown` and validate/narrow.

### Runtime Validation

Use Zod only at trust boundaries:

- config input;
- external API payloads where validation is valuable;
- IPC messages.

Do not Zod-parse every internal object repeatedly.

### Error Handling

Do not use exceptions as routine control flow.

Infrastructure may throw; adapters/use cases map them into stable application errors.

Never `catch {}` silently.

### Async

- every started async task has ownership and cancellation/lifecycle strategy;
- avoid fire-and-forget promises unless wrapped in a supervised utility that reports errors;
- use AbortController for cancellable HTTP/search;
- do not block event loop with heavy DSP/computation.

## 10. React Rules

- components render; use cases perform business operations;
- no raw Spotify HTTP calls in components;
- no raw IPC serialization in components;
- keep effects narrow and idempotent;
- avoid effects for derived state that can be computed during render/selectors;
- use stable command registry for keyboard actions;
- avoid global atoms for purely local UI state.

## 11. Jotai Rules

Atoms are small and semantic.

Avoid one giant `appStateAtom` object that recreates Redux-style global mutation.

Derived values should use derived atoms/selectors when it improves recomputation clarity.

High-frequency visualizer frames are forbidden in Jotai.

## 12. XState Rules

Use state machines only when states/transitions matter.

Good candidates:

- auth lifecycle;
- player supervision;
- application bootstrap/degraded/shutdown.

Bad candidate:

- simple boolean modal visibility;
- selected row index;
- static form data.

Machine events use domain language (`PLAYER_EXITED`, `AUTH_GRANTED`) rather than UI details (`BUTTON_CLICKED`) unless the machine truly owns UI interaction.

## 13. Rust Rules

### Ownership and Concurrency

Prefer message passing/owned state over broad shared mutexes.

Never hold a lock across `.await` unless specifically designed and justified.

Audio path must use bounded, non-blocking handoff to analysis/IPC.

### Error Handling

- no `unwrap()`/`expect()` in normal runtime paths unless an invariant is proven and message explains it;
- map upstream errors at adapter boundaries;
- preserve source error for local diagnostics where safe;
- user-facing error code is stable and redacted.

### Unsafe

Project code SHOULD contain no `unsafe` unless absolutely required by platform/FFI integration. Any `unsafe` block requires:

- safety comment explaining invariant;
- focused tests;
- code-review attention.

### Logging

Use `tracing`; never `println!` to stdout in the player process because stdout is IPC transport.

## 14. Protocol Rules

- protocol structures are distinct from domain structures;
- explicit version field;
- unknown additive fields ignored;
- unknown command handled cleanly;
- maximum message size enforced;
- sensitive fields redacted from diagnostic serialization.

## 15. Database Rules

- SQL is isolated in cache adapter/repository modules;
- no ORM for MVP;
- parameterized queries only;
- migrations versioned and tested;
- transactions around multi-step cache updates;
- no secrets in SQLite.

## 16. Dependency Policy

Before adding a dependency, document in PR:

1. problem it solves;
2. why runtime/stdlib is insufficient;
3. maintenance/platform cost;
4. license/security consideration;
5. whether dependency is runtime or dev-only.

Avoid large utility packages for one small helper.

Pin/lock all production dependencies.

## 17. Comments and Documentation

Comments explain **why**, invariants, protocol quirks, or external constraints.

Do not comment obvious syntax.

Public/domain interfaces SHOULD have concise documentation when semantics are not obvious.

Any workaround for Spotify/librespot behavior MUST include:

- what upstream behavior necessitates it;
- link/issue/reference if available;
- removal condition.

## 18. Formatting and Linting

### TypeScript

Use **Oxlint** as the canonical linter and **Oxfmt** as the canonical formatter.

Do not add ESLint, Prettier, or Biome in parallel unless a documented capability gap cannot be solved with Oxlint/Oxfmt. One concern MUST have one authoritative tool.

### Rust

Use the official Rust toolchain:

- `rustfmt` is the canonical formatter;
- Clippy is the canonical linter;
- CI runs `cargo fmt --check`;
- CI runs `cargo clippy --all-targets --all-features -- -D warnings`;
- lint allowances MUST be narrow and justified near the allowance or in workspace configuration.

Use `cargo-deny` in CI for dependency advisories, license policy, banned crates, and unexpected dependency sources. `cargo-machete` MAY run periodically or in CI to detect unused dependencies, but it is not a correctness gate when false positives are justified.

Formatting disagreements are resolved by tooling, not review discussion.

## 19. Testing Rules

Every bug fix SHOULD include a regression test at the lowest meaningful boundary.

Do not mock implementation details when a fake port can represent behavior.

Tests use Arrange/Act/Assert semantics but need not label each section mechanically.

Avoid sleep-based timing tests where a fake clock can be used.

## 20. Performance Rules

Optimize only when:

- requirement demands it (audio/visualizer); or
- profiling/benchmark demonstrates a problem.

Known proactive performance boundaries:

- audio path non-blocking;
- visualizer latest-value only;
- playback progress not emitted at 60 Hz;
- large lists paginated/virtualized as OpenTUI capabilities allow;
- Web API requests cached/debounced.

## 21. Security Rules

- never log secrets;
- validate all external input;
- avoid shell command construction from arbitrary strings;
- callback binds loopback only;
- use least privilege;
- dependency updates reviewed for security and behavior changes;
- keyring unavailability never silently falls back to plaintext secrets.

## 22. Git and Commit Standard

Use Conventional Commits, for example:

```text
feat(player): add queue revision events
fix(auth): reject mismatched oauth state
perf(visualizer): replace pending spectrum frame
refactor(ui): centralize command registry
test(ipc): add unsupported-version fixture
docs(tsd): document cache migration policy
```

Commits SHOULD be logically coherent and build/test where practical.

## 23. Pull Request Checklist

A PR is ready when applicable:

- architecture boundary respected;
- no unnecessary dependency added;
- errors mapped/redacted;
- tests added/updated;
- protocol/config migration handled;
- accessibility/focus considered for UI changes;
- performance impact considered for hot paths;
- logs contain no secrets;
- docs/ADR updated for architectural change;
- formatter/linter/tests pass.

## 24. Definition of Done for Code

Code is done when it is:

- correct;
- understandable without author explanation;
- appropriately tested;
- observable enough to diagnose failures;
- secure at its trust boundaries;
- free of knowingly duplicated business rules;
- no more abstract than current requirements justify.
