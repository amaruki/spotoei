// Raw Spotify API response types and shared interfaces for the Web API client.
// `unknown` payload arrives at the boundary; these shapes let mappers narrow safely
// without an `any` cast.

import type { RestrictionStore } from './transport';

export type { RestrictionStore };

export interface TokenPayload {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string | null;
  refreshToken?: string | null;
  expires_in?: number;
  expiresAt?: number;
  [key: string]: unknown;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  invalidateToken?(): void;
  getRefreshToken?(): string | undefined;
  setRefreshToken?(token?: string | null): void;
}
export interface WebApiClientOptions {
  tokenProvider: TokenProvider;
  baseUrl?: string;
  restrictionStore?: RestrictionStore;
}

export interface RawArtistRef {
  id?: unknown;
  name?: unknown;
  uri?: unknown;
}

export interface RawImageRef {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface RawAlbumRef {
  id?: unknown;
  name?: unknown;
  images?: unknown;
}

export interface RawTrack {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  artists?: unknown;
  album?: unknown;
  duration_ms?: unknown;
  explicit?: unknown;
  is_playable?: unknown;
}

export interface RawPage {
  items?: unknown[];
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  next?: unknown;
  cursors?: { after?: unknown; before?: unknown } | null;
}

export interface RawAlbum {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  artists?: unknown;
  images?: unknown;
  release_date?: unknown;
  total_tracks?: unknown;
  album_type?: unknown;
  tracks?: RawPage;
}

export interface RawArtist {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  images?: unknown;
  genres?: unknown;
  followers?: unknown;
}

export interface RawPlaylist {
  id?: unknown;
  uri?: unknown;
  name?: unknown;
  images?: unknown;
  owner?: unknown;
  description?: unknown;
  public?: unknown;
  collaborative?: unknown;
  tracks?: unknown;
}

export interface RawSearchResponse {
  tracks?: RawPage;
  albums?: RawPage;
  artists?: RawPage;
  playlists?: RawPage;
  shows?: RawPage;
  episodes?: RawPage;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequestOptions {
  path: string;
  paramsOrBody?: unknown;
  method?: HttpMethod;
}
