// The main module was split into `apps/tui/src/main/` for the < 300 LoC
// per-file ceiling. This shim preserves the original `from './main'`
// import path for existing callers (tests, build scripts).
export { main } from './main/index';
import './main/entry';
