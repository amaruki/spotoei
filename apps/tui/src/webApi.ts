// Thin re-export shim. The implementation lives in ./webApi/ as a directory
// of focused modules. This file is kept so existing import paths
// (`from './webApi'`) continue to resolve without changes.
export * from './webApi/index';
