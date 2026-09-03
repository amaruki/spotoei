// Targeted, used-once shape-narrowing helpers for raw Spotify JSON payloads.
// These are leaf utilities for mappers; nothing here is exported through the
// public WebApiClient surface.

import type { CatalogTrackT } from 'spotoei-protocol';
import type { RawAlbum, RawAlbumRef, RawArtistRef, RawImageRef, RawSearchResponse } from './types';

export function toSearchResponse(raw: unknown): RawSearchResponse {
  if (raw === null || typeof raw !== 'object') return {};
  return raw as RawSearchResponse;
}

export function toAlbum(raw: unknown): RawAlbum {
  if (raw === null || typeof raw !== 'object') return {};
  return raw as RawAlbum;
}

export function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toArtistList(value: unknown): CatalogTrackT['artists'] {
  if (!Array.isArray(value)) {
    return [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }];
  }
  const out = value
    .filter((a): a is RawArtistRef => a !== null && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : 'unknown',
      name: typeof a.name === 'string' ? a.name : 'Unknown',
      uri:
        typeof a.uri === 'string'
          ? a.uri
          : `spotify:artist:${typeof a.id === 'string' ? a.id : 'unknown'}`,
    }));
  return out.length > 0 ? out : [{ id: 'unknown', name: 'Unknown', uri: 'spotify:artist:unknown' }];
}

export function toAlbumRef(value: unknown): RawAlbumRef {
  if (value === null || typeof value !== 'object') return {};
  return value as RawAlbumRef;
}

export function toFirstImage(value: unknown): CatalogTrackT['image'] {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const img = entry as RawImageRef;
    if (typeof img.url !== 'string') continue;
    return {
      url: img.url,
      width: typeof img.width === 'number' ? img.width : undefined,
      height: typeof img.height === 'number' ? img.height : undefined,
    };
  }
  return undefined;
}

export function pickObjectKey(obj: unknown, key: string): unknown {
  if (obj !== null && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

export function readNumber(obj: unknown, key: string, fallback: number): number {
  const v = pickObjectKey(obj, key);
  return typeof v === 'number' ? v : fallback;
}
