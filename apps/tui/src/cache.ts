// Thin re-export shim. The implementation lives in ./cache/ as a directory
// of focused modules. This file is kept so existing import paths
// (`from './cache'`) continue to resolve without changes.
export * from './cache/index';
