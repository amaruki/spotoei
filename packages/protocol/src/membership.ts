import { z } from 'zod';

export const LibraryItemKind = z.enum(['track', 'album', 'artist', 'playlist']);
export type LibraryItemKindT = z.infer<typeof LibraryItemKind>;

export const SaveState = z.enum(['unknown', 'loading', 'saved', 'not_saved', 'unavailable']);
export type SaveStateT = z.infer<typeof SaveState>;

export const LibraryMembership = z.object({
  uri: z.string(),
  kind: LibraryItemKind,
  state: SaveState,
  updatedAt: z.number().int().nonnegative().optional(),
});
export type LibraryMembershipT = z.infer<typeof LibraryMembership>;

export const GenericLibraryMutation = z.object({
  uris: z.array(z.string()),
});
export type GenericLibraryMutationT = z.infer<typeof GenericLibraryMutation>;
