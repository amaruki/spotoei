// Public re-exports for the UI layer. The entire UI was split from a
// single 1809 LoC file into smaller, single-responsibility modules.
// All sub-modules stay strictly under the 300 LoC limit.

export * from './types';
export * from './theme';
export * from './formatters';
export * from './visualizerCanvas';
export * from './views/home';
export * from './views/nav';
export * from './views/settings';
export * from './views/lyrics';
export * from './views/search';
export * from './views/library';
export * from './views/queue';
export * from './componentTree';
export * from './core';
