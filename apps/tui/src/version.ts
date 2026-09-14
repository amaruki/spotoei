// Single source of truth for the application version. `scripts/package.ts`
// and the release workflow read the same value from package.json.
import pkg from '../../../package.json';

export const APP_VERSION: string = pkg.version;
export const UI_VERSION = `spotoei-tui/${APP_VERSION}`;
