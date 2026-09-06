// @ts-nocheck
import type {
  CatalogEpisodeT,
  CatalogShowT,
  EntityViewResponseT,
} from 'spotoei-protocol';
import { mapEpisode, mapShow } from './mappers';
import { pickObjectKey, toArray } from './shape';
import { ApiError } from './transport';
import type { Transport } from './transport';

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export interface ShowEpisodePage {
  items: CatalogEpisodeT[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export class ShowEndpoints {
  constructor(private transport: Transport) {}

  async getShowView(id: string, signal?: AbortSignal): Promise<EntityViewResponseT> {
    try {
      const json = await this.transport.request(
        `/shows/${encodeURIComponent(id)}?market=from_token`,
        {},
        'GET',
        signal,
      );
      const show = mapShow(json);
      if (!show) throw new Error('invalid show payload');
      return { type: 'show', show: show as CatalogShowT, completeness: 'complete' };
    } catch (err: unknown) {
      return {
        type: 'show',
        show: {
          id,
          uri: `spotify:show:${id}`,
          name: 'Unavailable show',
        },
        completeness: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getShowEpisodes(
    id: string,
    offset = 0,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<ShowEpisodePage> {
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    try {
      const json = await this.transport.request(
        `/shows/${encodeURIComponent(id)}/episodes?market=from_token&limit=${safeLimit}&offset=${safeOffset}`,
        {},
        'GET',
        signal,
      );
      const items = toArray(pickObjectKey(json, 'items'));
      const rawLen = items.length;
      const episodes: CatalogEpisodeT[] = [];
      for (const raw of items) {
        const mapped = mapEpisode(raw);
        if (mapped) episodes.push(mapped);
      }
      const hasTotal = typeof (json as { total?: unknown }).total === 'number';
      const total = hasTotal ? (json as { total: number }).total : episodes.length;
      const hasMore = hasTotal ? safeOffset + rawLen < total : rawLen === safeLimit;
      return {
        items: episodes,
        total,
        offset: safeOffset,
        limit: safeLimit,
        hasMore,
      };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError) {
        if (err.code === 'API_QUOTA_EXCEEDED' || err.code === 'API_RATE_LIMITED') throw err;
      }
      if (msg.includes('API_QUOTA_EXCEEDED') || /quota/i.test(msg)) {
        throw new ApiError('API_QUOTA_EXCEEDED', msg, 429, false);
      }
      return { items: [], total: 0, offset: safeOffset, limit: safeLimit, hasMore: false };
    }
  }
}
