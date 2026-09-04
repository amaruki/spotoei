import { z } from 'zod';
import { BrowsePath, HomeTab } from './home';
import { LibraryCollection } from './catalog';

export const ArtistReleaseGroup = z.enum(['album', 'single', 'appears_on', 'compilation']);
export type ArtistReleaseGroupT = z.infer<typeof ArtistReleaseGroup>;

export const RouteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('home'),
    tab: HomeTab,
    // Deprecated: Browse is moving to `kind: 'browse'`. Kept until
    // consumers migrate off `{ kind: 'home', tab: 'browse' }`.
    browse: BrowsePath.optional(),
  }),
  z.object({
    kind: z.literal('browse'),
    path: BrowsePath.optional(),
  }),
  z.object({
    kind: z.literal('search'),
    query: z.string().optional(),
  }),
  z.object({
    kind: z.literal('library'),
    section: LibraryCollection,
  }),
  z.object({
    kind: z.literal('queue'),
  }),
  z.object({
    kind: z.literal('lyrics'),
  }),
  z.object({
    kind: z.literal('settings'),
  }),
  z.object({
    kind: z.literal('onboarding'),
  }),
  z.object({
    kind: z.literal('visualizer'),
  }),
  z.object({
    kind: z.literal('artist'),
    id: z.string(),
  }),
  z.object({
    kind: z.literal('album'),
    id: z.string(),
  }),
  z.object({
    kind: z.literal('playlist'),
    id: z.string(),
  }),
]);
export type RouteT = z.infer<typeof RouteSchema>;
