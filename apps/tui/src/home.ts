// Home tab coordinator: manages loading, caching, and state for Home sub-views.

import type {
  HomeForYouDataT,
  HomeRecentlyPlayedDataT,
  HomeTabT,
  RecentlyPlayedItemT,
  TimeRangeT,
} from 'spotoei-protocol';
import type { Cache } from './cache';
import type { WebApiClient } from './webApi';

export class HomeManager {
  constructor(
    private client: WebApiClient,
    private cache?: Cache,
    private accountId: string = 'default',
  ) {}

  async loadForYou(
    timeRange: TimeRangeT = 'medium_term',
    forceRefresh = false,
  ): Promise<HomeForYouDataT> {
    const cacheKey = `home:v2:foryou:${timeRange}`;
    if (!forceRefresh && this.cache) {
      try {
        const cached = this.cache.getQuery<HomeForYouDataT>(this.accountId, cacheKey);
        if (cached && this.isFresh(cached.expiresAt)) return cached.payload;
      } catch {
        // Fall back to live fetch
      }
    }

    const [topTracks, topArtists] = await Promise.all([
      this.client.getUserTopTracks(timeRange, 5),
      this.client.getUserTopArtists(timeRange, 5),
    ]);

    const data: HomeForYouDataT = {
      topTracks,
      topArtists,
      range: timeRange,
    };

    if (this.cache) {
      try {
        this.cache.putQuery(this.accountId, cacheKey, data, 600_000);
      } catch {
        // Non-fatal
      }
    }

    return data;
  }

  async loadRecentlyPlayed(forceRefresh = false): Promise<HomeRecentlyPlayedDataT> {
    const cacheKey = 'home:v2:recently_played';
    if (!forceRefresh && this.cache) {
      try {
        const cached = this.cache.getQuery<HomeRecentlyPlayedDataT>(this.accountId, cacheKey);
        if (cached && this.isFresh(cached.expiresAt)) return cached.payload;
      } catch {
        // Fall back to live fetch
      }
    }

    const raw = await this.client.getRecentlyPlayed(20);
    const items: RecentlyPlayedItemT[] = raw.map((r) => ({
      track: r.track,
      playedAt: r.playedAt,
    }));

    const data: HomeRecentlyPlayedDataT = { items };

    if (this.cache) {
      try {
        this.cache.putQuery(this.accountId, cacheKey, data, 60_000);
      } catch {
        // Non-fatal
      }
    }

    return data;
  }

  private isFresh(expiresAt: number | null): boolean {
    if (expiresAt === null) return false;
    return Date.now() < expiresAt;
  }
}

export interface HomeViewState {
  activeTab: HomeTabT;
  timeRange: TimeRangeT;
  forYou?: HomeForYouDataT;
  recentlyPlayed?: HomeRecentlyPlayedDataT;
  loading: boolean;
  error?: string;
}

export function createInitialHomeState(): HomeViewState {
  return {
    activeTab: 'for_you',
    timeRange: 'medium_term',
    loading: false,
  };
}
