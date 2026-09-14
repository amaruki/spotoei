import type { CatalogAlbumT, CatalogPlaylistT } from 'spotoei-protocol';
import { mapAlbum, mapCategory, type CategoryT, mapPlaylist } from './mappers';
import { pickObjectKey, toArray } from './shape';
import type { Transport } from './transport';

function clampLimit(v: number): number {
  return Math.min(50, Math.max(1, Math.floor(v)));
}

function normalizeLocale(locale: string): string {
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(locale) ? locale : 'en_US';
}

function isBrowseRestriction(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Quota exhaustion is transient and must keep surfacing as quota,
  // never as a permanent endpoint restriction.
  if (/QUOTA/i.test(msg)) return false;
  return /FORBIDDEN/.test(msg) || /\b403\b/.test(msg) || /HTTP_404/.test(msg);
}

export class BrowseEndpoints {
  constructor(private transport: Transport) {}

  async getNewReleases(limit = 20): Promise<CatalogAlbumT[]> {
    // /browse/new-releases is restricted for dev apps without Extended Quota
    // (403) and flagged deprecated. Treat restriction as empty — not fatal —
    // so callers fall through to recommendations/history and the empty result
    // gets cached instead of retry-storming every home load.
    try {
      const json = await this.transport.request('/browse/new-releases', {
        limit: clampLimit(limit),
      });
      return toArray(pickObjectKey(pickObjectKey(json, 'albums'), 'items'))
        .map(mapAlbum)
        .filter((album): album is CatalogAlbumT => album !== null);
    } catch (error) {
      if (isBrowseRestriction(error)) return [];
      throw error;
    }
  }

  async getCategories(
    locale = 'en_US',
    limit = 20,
    offsetOrSignal?: number | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<CategoryT[]> {
    let offset = 0;
    let signal: AbortSignal | undefined;
    if (typeof offsetOrSignal === 'number') {
      offset = offsetOrSignal;
      signal = maybeSignal;
    } else if (
      offsetOrSignal instanceof AbortSignal ||
      (offsetOrSignal !== null &&
        typeof offsetOrSignal === 'object' &&
        typeof (offsetOrSignal as AbortSignal).aborted === 'boolean')
    ) {
      signal = offsetOrSignal as AbortSignal;
    } else if (offsetOrSignal !== undefined) {
      offset = Number(offsetOrSignal) || 0;
    }
    return getBrowseCategories(this.transport, limit, offset, signal, locale);
  }

  async getBrowseCategories(limit = 20, offset = 0, signal?: AbortSignal): Promise<CategoryT[]> {
    return getBrowseCategories(this.transport, limit, offset, signal);
  }

  async getCategoryPlaylists(
    categoryId: string,
    limit = 20,
    offsetOrSignal?: number | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<CatalogPlaylistT[]> {
    let offset = 0;
    let signal: AbortSignal | undefined;
    if (typeof offsetOrSignal === 'number') {
      offset = offsetOrSignal;
      signal = maybeSignal;
    } else if (
      offsetOrSignal instanceof AbortSignal ||
      (offsetOrSignal !== null &&
        typeof offsetOrSignal === 'object' &&
        typeof (offsetOrSignal as AbortSignal).aborted === 'boolean')
    ) {
      signal = offsetOrSignal as AbortSignal;
    } else if (offsetOrSignal !== undefined) {
      offset = Number(offsetOrSignal) || 0;
    }
    return getCategoryPlaylists(this.transport, categoryId, limit, offset, signal);
  }
}

export async function getBrowseCategories(
  transport: Transport,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
  locale = 'en_US',
): Promise<CategoryT[]> {
  const safeLocale = normalizeLocale(locale);
  const safeLimit = clampLimit(limit);
  const safeOffset = Math.max(0, Math.floor(offset));
  const params = new URLSearchParams();
  params.set('locale', safeLocale);
  params.set('limit', String(safeLimit));
  params.set('offset', String(safeOffset));
  const json = await transport.request(
    `/browse/categories?${params.toString()}`,
    {},
    'GET',
    signal,
  );
  const container = pickObjectKey(json, 'categories');
  const items = toArray(pickObjectKey(container, 'items'));
  const out: CategoryT[] = [];
  for (const raw of items) {
    const mapped = mapCategory(raw);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function getCategoryPlaylists(
  transport: Transport,
  categoryId: string,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<CatalogPlaylistT[]> {
  const safeLimit = clampLimit(limit);
  const safeOffset = Math.max(0, Math.floor(offset));
  const params = new URLSearchParams();
  params.set('limit', String(safeLimit));
  params.set('offset', String(safeOffset));
  params.set('market', 'from_token');
  const encoded = encodeURIComponent(categoryId);
  const json = await transport.request(
    `/browse/categories/${encoded}/playlists?${params.toString()}`,
    {},
    'GET',
    signal,
  );
  const container = pickObjectKey(json, 'playlists');
  const items = toArray(pickObjectKey(container, 'items'));
  const out: CatalogPlaylistT[] = [];
  for (const raw of items) {
    if (raw === null || raw === undefined) continue;
    const mapped = mapPlaylist(raw);
    if (mapped) out.push(mapped);
  }
  return out;
}
