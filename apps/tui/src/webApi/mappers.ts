// Mappers that turn raw Spotify API JSON into typed catalog objects.
// Each mapper runs Zod validation at the boundary; the typed output is the
// only thing downstream code sees.

import {
  CatalogAlbum as AlbumSchema,
  CatalogArtist as ArtistSchema,
  CatalogPlaylist as PlaylistSchema,
  CatalogTrack as TrackSchema,
  type CatalogAlbumT,
  type CatalogArtistT,
  type CatalogPlaylistT,
  type CatalogTrackT,
} from 'spotoei-protocol';
import { toAlbumRef, toArtistList, toFirstImage } from './shape';
import type { RawAlbum, RawArtist, RawPlaylist, RawTrack } from './types';

export function mapTrack(raw: unknown): CatalogTrackT | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as RawTrack;
  if (typeof candidate.id !== 'string') return null;

  const id = candidate.id;
  const artistList = toArtistList(candidate.artists);
  const albumRef = toAlbumRef(candidate.album);
  const firstImg = toFirstImage(albumRef.images);
  const durationMs = typeof candidate.duration_ms === 'number' ? candidate.duration_ms : 0;
  const isExplicit = typeof candidate.explicit === 'boolean' ? candidate.explicit : undefined;
  const isPlayable = typeof candidate.is_playable === 'boolean' ? candidate.is_playable : undefined;

  const track = {
    id,
    uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:track:${id}`,
    name: typeof candidate.name === 'string' ? candidate.name : 'Untitled',
    artists: artistList,
    albumId: albumRef.id,
    albumName: albumRef.name,
    durationMs,
    image: firstImg,
    isExplicit,
    isPlayable,
  };
  const parsed = TrackSchema.safeParse(track);
  return parsed.success ? parsed.data : null;
}

export function mapAlbum(raw: unknown): CatalogAlbumT | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as RawAlbum;
  if (typeof candidate.id !== 'string') return null;

  const id = candidate.id;
  const artistList = toArtistList(candidate.artists);
  const firstImg = toFirstImage(candidate.images);
  const releaseDate =
    typeof candidate.release_date === 'string' ? candidate.release_date : undefined;
  const totalTracks =
    typeof candidate.total_tracks === 'number' ? candidate.total_tracks : undefined;
  const albumType =
    candidate.album_type === 'album' ||
    candidate.album_type === 'single' ||
    candidate.album_type === 'compilation'
      ? candidate.album_type
      : undefined;

  const album = {
    id,
    uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:album:${id}`,
    name: typeof candidate.name === 'string' ? candidate.name : 'Untitled Album',
    artists: artistList,
    image: firstImg,
    releaseDate,
    totalTracks,
    albumType,
  };
  const parsed = AlbumSchema.safeParse(album);
  return parsed.success ? parsed.data : null;
}

export function mapArtist(raw: unknown): CatalogArtistT | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as RawArtist;
  if (typeof candidate.id !== 'string') return null;

  const id = candidate.id;
  const firstImg = toFirstImage(candidate.images);
  const genres = Array.isArray(candidate.genres)
    ? candidate.genres.filter((g): g is string => typeof g === 'string')
    : undefined;
  const followersObj =
    candidate.followers !== null && typeof candidate.followers === 'object'
      ? (candidate.followers as { total?: unknown })
      : null;
  const followers =
    followersObj && typeof followersObj.total === 'number' ? followersObj.total : undefined;

  const artist = {
    id,
    uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:artist:${id}`,
    name: typeof candidate.name === 'string' ? candidate.name : 'Unknown Artist',
    image: firstImg,
    genres,
    followers,
  };
  const parsed = ArtistSchema.safeParse(artist);
  return parsed.success ? parsed.data : null;
}

export function mapPlaylist(raw: unknown): CatalogPlaylistT | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as RawPlaylist;
  if (typeof candidate.id !== 'string') return null;

  const id = candidate.id;
  const firstImg = toFirstImage(candidate.images);

  const ownerObj =
    candidate.owner !== null && typeof candidate.owner === 'object'
      ? (candidate.owner as { id?: unknown; display_name?: unknown })
      : null;
  const owner =
    ownerObj && typeof ownerObj.id === 'string'
      ? {
          id: ownerObj.id,
          name: typeof ownerObj.display_name === 'string' ? ownerObj.display_name : ownerObj.id,
        }
      : undefined;

  const tracksObj =
    candidate.tracks !== null && typeof candidate.tracks === 'object'
      ? (candidate.tracks as { total?: unknown })
      : null;
  const trackCount = tracksObj && typeof tracksObj.total === 'number' ? tracksObj.total : undefined;

  const isPublic = typeof candidate.public === 'boolean' ? candidate.public : undefined;
  const isCollaborative =
    typeof candidate.collaborative === 'boolean' ? candidate.collaborative : undefined;

  const playlist = {
    id,
    uri: typeof candidate.uri === 'string' ? candidate.uri : `spotify:playlist:${id}`,
    name: typeof candidate.name === 'string' ? candidate.name : 'Untitled Playlist',
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    owner,
    image: firstImg,
    trackCount,
    isPublic,
    isCollaborative,
  };
  const parsed = PlaylistSchema.safeParse(playlist);
  return parsed.success ? parsed.data : null;
}
