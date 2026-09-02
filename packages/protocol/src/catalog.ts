// Domain models for Spotify-derived entities (CatalogTrack/CatalogAlbum/etc.).
// These are SPOTOEI-owned validated shapes; the raw Spotify payload is parsed
// at the Web API adapter boundary and never leaves that module.
//
// Naming note: the playback layer in `playback.ts` owns `Track`/`TrackT`
// (a minimal wire shape). Catalog uses `Catalog*` to avoid the collision.

import { z } from 'zod';

// Spotify's "type" field on URI namespacing. Used as a discriminator so a
// search result for "track" vs "album" stays unambiguous downstream.
export const EntityType = z.enum(['track', 'album', 'artist', 'playlist']);
export type EntityTypeT = z.infer<typeof EntityType>;

// A small image reference. We only carry URL + dimensions; full image
// metadata is irrelevant to the TUI's render path.
export const ImageRef = z.object({
  url: z.string(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
});
export type ImageRefT = z.infer<typeof ImageRef>;

// Track artist. Kept narrow on purpose: only what the entity view and
// search result need to render.
export const TrackArtist = z.object({
  id: z.string(),
  name: z.string(),
  uri: z.string(),
});
export type TrackArtistT = z.infer<typeof TrackArtist>;

// Full track domain. `id`/`uri`/`name` are required so the TUI can hand it
// straight to `playback.load` without re-deriving. `durationMs` is the only
// numeric field the playback engine consumes; everything else is render-only.
export const CatalogTrack = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  artists: z.array(TrackArtist).min(1),
  albumId: z.string().optional(),
  albumName: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
  image: ImageRef.optional(),
  isExplicit: z.boolean().optional(),
  isPlayable: z.boolean().optional(),
});
export type CatalogTrackT = z.infer<typeof CatalogTrack>;

// Album domain. We keep the artist list and a small cover image; track lists
// are loaded on demand via the album-tracks endpoint.
export const CatalogAlbum = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  artists: z.array(TrackArtist).min(1),
  image: ImageRef.optional(),
  releaseDate: z.string().optional(),
  totalTracks: z.number().int().nonnegative().optional(),
  albumType: z.enum(['album', 'single', 'compilation']).optional(),
});
export type CatalogAlbumT = z.infer<typeof CatalogAlbum>;

// Artist domain. `genres`/`followers` are render-only.
export const CatalogArtist = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  image: ImageRef.optional(),
  genres: z.array(z.string()).optional(),
  followers: z.number().int().nonnegative().optional(),
});
export type CatalogArtistT = z.infer<typeof CatalogArtist>;

// Playlist domain. `owner` is render-only and may be missing on owned views.
export const CatalogPlaylist = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  owner: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  image: ImageRef.optional(),
  trackCount: z.number().int().nonnegative().optional(),
  isPublic: z.boolean().optional(),
  isCollaborative: z.boolean().optional(),
});
export type CatalogPlaylistT = z.infer<typeof CatalogPlaylist>;

// A single hit in a search result. Discriminated by `type` so the matching
// entity field is enforced and unrelated entity fields are rejected.
export const SearchHit = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('track'),
    score: z.number().optional(),
    track: CatalogTrack,
  }),
  z.object({
    type: z.literal('album'),
    score: z.number().optional(),
    album: CatalogAlbum,
  }),
  z.object({
    type: z.literal('artist'),
    score: z.number().optional(),
    artist: CatalogArtist,
  }),
  z.object({
    type: z.literal('playlist'),
    score: z.number().optional(),
    playlist: CatalogPlaylist,
  }),
]);
export type SearchHitT = z.infer<typeof SearchHit>;

// The full search response. The TUI is responsible for rendering only the
// `hits` and showing a compact "no results" / "error" affordance when the
// adapter returns `error`.
export const SearchResponse = z.object({
  query: z.string(),
  hits: z.array(SearchHit),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
    })
    .optional(),
});
export type SearchResponseT = z.infer<typeof SearchResponse>;

// One entity-view response, paired with a `completeness` flag.
export const EntityViewResponse = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('track'),
    track: CatalogTrack,
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('album'),
    album: CatalogAlbum,
    tracks: z.array(CatalogTrack).optional(),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('artist'),
    artist: CatalogArtist,
    topTracks: z.array(CatalogTrack).optional(),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('playlist'),
    playlist: CatalogPlaylist,
    tracks: z.array(CatalogTrack).optional(),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    reason: z.string().optional(),
  }),
]);

// Library collections supported by the local library view.
export const LibraryCollection = z.enum([
  'saved_tracks',
  'saved_albums',
  'followed_artists',
  'playlists',
]);
export type LibraryCollectionT = z.infer<typeof LibraryCollection>;

export const LibraryPageResponse = z.object({
  collection: LibraryCollection,
  items: z.array(z.union([CatalogTrack, CatalogAlbum, CatalogArtist, CatalogPlaylist])),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
});
export type LibraryPageResponseT = z.infer<typeof LibraryPageResponse>;

export const QueueSource = z.enum(['user', 'context', 'autoplay']);
export type QueueSourceT = z.infer<typeof QueueSource>;

export const QueueItem = z.object({
  id: z.string(),
  track: CatalogTrack,
  source: QueueSource,
  addedAt: z.number().int().nonnegative(),
});
export type QueueItemT = z.infer<typeof QueueItem>;

export const QueueSnapshot = z.object({
  current: CatalogTrack.nullable(),
  upcoming: z.array(QueueItem),
  revision: z.number().int().nonnegative(),
});
export type QueueSnapshotT = z.infer<typeof QueueSnapshot>;
export type EntityViewResponseT = z.infer<typeof EntityViewResponse>;
