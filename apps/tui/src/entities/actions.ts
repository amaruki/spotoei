// Entity open and play actions shared by Search, Library, Home, Browse.
// Non-track hits open entity pages; tracks play in their context.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { RouteT, SearchHitT } from 'spotoei-protocol';
import { getConfigDir, getConfigPath, readValidConfig } from '../config';

export function entityRouteForHit(hit: SearchHitT): RouteT | null {
  switch (hit.type) {
    case 'artist':
      return { kind: 'artist', id: hit.artist.id };
    case 'album':
      return { kind: 'album', id: hit.album.id };
    case 'playlist':
      return { kind: 'playlist', id: hit.playlist.id };
    default:
      return null;
  }
}

export function headerPlayContext(route: RouteT, uri: string): { contextUri: string } {
  void route;
  return { contextUri: uri };
}

export function trackPlayInContext(
  trackUri: string,
  contextUri?: string,
): { trackUri: string; contextUri?: string } {
  return contextUri ? { trackUri, contextUri } : { trackUri };
}

export function pinDrivingPlaylist(uri: string, configPath: string = getConfigPath()): string[] {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let current = readValidConfig(configPath);
  if (!existsSync(configPath)) current = {};
  const pins = current.browse?.drivingPlaylistUris ?? [];
  if (pins.includes(uri)) return pins;
  const updated = {
    ...current,
    browse: {
      charts: current.browse?.charts ?? [],
      editorialPlaylists: current.browse?.editorialPlaylists ?? [],
      drivingPlaylistUris: [...pins, uri],
    },
  };
  writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
  return updated.browse.drivingPlaylistUris;
}

export function readDrivingPinsForTest(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      browse?: { drivingPlaylistUris?: string[] };
    };
    return parsed.browse?.drivingPlaylistUris ?? [];
  } catch {
    return [];
  }
}
