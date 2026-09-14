// Entity loaders were split into sibling modules for the < 300 LoC
// ceiling. This shim preserves the original import path.
export type { EntityLoaderDeps } from './entityPages';
export { poolTracksForRoute } from './entityPages';
export { ensureEntityRoute } from './entityRoute';
export { loadMoreEntityItems, switchArtistGroup } from './entityPaging';
