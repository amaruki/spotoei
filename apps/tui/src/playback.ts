// Thin re-export shim. The implementation lives in ./playback/ as a
// directory of focused modules. This file is kept so existing import
// paths (`from './playback'`) continue to resolve without changes.
export * from './playback/index';
