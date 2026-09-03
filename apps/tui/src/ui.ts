// The UI module was split into `apps/tui/src/ui/` for the < 300 LoC
// per-file ceiling. This shim preserves the original `from './ui'`
// import path for existing callers (main.ts, tests).
export * from './ui/index';
