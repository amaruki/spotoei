import { z } from 'zod';

export const HomeTab = z.enum(['for_you', 'browse', 'recently_played']);
export type HomeTabT = z.infer<typeof HomeTab>;

export const BrowseCategoryId = z.string();
export type BrowseCategoryIdT = string;

export const BrowseEntryId = z.string();
export type BrowseEntryIdT = string;

export const BrowsePath = z.object({
  category: BrowseCategoryId.optional(),
  entry: BrowseEntryId.optional(),
});
export type BrowsePathT = z.infer<typeof BrowsePath>;

export const TimeRange = z.enum(['short_term', 'medium_term', 'long_term']);
export type TimeRangeT = z.infer<typeof TimeRange>;

export const HomeForYouData = z.object({
  topTracks: z.array(z.unknown()),
  topArtists: z.array(z.unknown()),
  range: TimeRange,
});
export type HomeForYouDataT = z.infer<typeof HomeForYouData>;

export const RecentlyPlayedItem = z.object({
  track: z.unknown(),
  playedAt: z.string(),
});
export type RecentlyPlayedItemT = z.infer<typeof RecentlyPlayedItem>;

export const HomeRecentlyPlayedData = z.object({
  items: z.array(RecentlyPlayedItem),
});
export type HomeRecentlyPlayedDataT = z.infer<typeof HomeRecentlyPlayedData>;
