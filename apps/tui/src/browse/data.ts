// Static browse category entries split out of `browse.ts` to keep
// the registry builder under the 300 LoC ceiling. The entries live in
// `entries*.ts` sibling modules; this file re-exports them so existing
// imports from `./browse/data` keep working.
export { DISCOVER_ENTRIES, NEW_RELEASES_ENTRIES, SEARCH_ALL_ENTRIES } from './entriesDiscover';
export { MOODS_ENTRIES, ACTIVITIES_ENTRIES } from './entriesMoods';
export { GENRES_ENTRIES, DECADES_ENTRIES } from './entriesGenres';
export { CHARTS_FALLBACK_ENTRIES, EDITORIAL_FALLBACK_ENTRIES } from './entriesFallbacks';
