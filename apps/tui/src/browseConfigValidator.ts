// Browse config validator — kept separate from `config.ts` to keep both files under 300 LoC.

import type { BrowseConfigT } from 'spotoei-protocol';

export function isValidBrowse(value: unknown): value is BrowseConfigT {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if ('charts' in v) {
    if (!Array.isArray(v.charts)) return false;
    for (const c of v.charts) {
      if (c === null || typeof c !== 'object') return false;
      const cr = c as Record<string, unknown>;
      if (typeof cr.id !== 'string' || cr.id.length === 0) return false;
      if (typeof cr.label !== 'string') return false;
      if (typeof cr.playlistUri !== 'string') return false;
      if (
        'countryCode' in cr &&
        cr.countryCode !== undefined &&
        typeof cr.countryCode !== 'string'
      ) {
        return false;
      }
    }
  }
  if ('editorialPlaylists' in v) {
    if (!Array.isArray(v.editorialPlaylists)) return false;
    for (const p of v.editorialPlaylists) {
      if (p === null || typeof p !== 'object') return false;
      const pr = p as Record<string, unknown>;
      if (typeof pr.id !== 'string' || pr.id.length === 0) return false;
      if (typeof pr.label !== 'string') return false;
      if (typeof pr.playlistUri !== 'string') return false;
    }
  }
  if ('drivingPlaylistUris' in v) {
    if (!Array.isArray(v.drivingPlaylistUris)) return false;
    for (const uri of v.drivingPlaylistUris) {
      if (typeof uri !== 'string') return false;
    }
  }
  return true;
}
