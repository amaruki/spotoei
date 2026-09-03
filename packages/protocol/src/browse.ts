import { z } from 'zod';
import { EntityType } from './catalog';

export const BrowseSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('search'),
    query: z.string(),
    types: z.array(EntityType),
  }),
  z.object({
    kind: z.literal('playlist'),
    playlistUri: z.string(),
  }),
  z.object({
    kind: z.literal('library'),
    collection: z.literal('playlists'),
  }),
  z.object({
    kind: z.literal('top_artists'),
  }),
  z.object({
    kind: z.literal('action'),
    action: z.literal('resume_queue'),
  }),
]);
export type BrowseSourceT = z.infer<typeof BrowseSource>;

export const BrowseEntry = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  source: BrowseSource,
});
export type BrowseEntryT = z.infer<typeof BrowseEntry>;

export const BrowseCategory = z.object({
  id: z.string(),
  label: z.string(),
  entries: z.array(BrowseEntry),
});
export type BrowseCategoryT = z.infer<typeof BrowseCategory>;

export const BrowseConfig = z.object({
  charts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      playlistUri: z.string(),
      countryCode: z.string().optional(),
    }),
  ),
  editorialPlaylists: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      playlistUri: z.string(),
    }),
  ),
  drivingPlaylistUris: z.array(z.string()),
});
export type BrowseConfigT = z.infer<typeof BrowseConfig>;
