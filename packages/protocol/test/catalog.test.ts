import { describe, expect, test } from 'bun:test';

import {
  CatalogAlbum,
  CatalogArtist,
  CatalogPlaylist,
  CatalogTrack,
  EntityType,
  EntityViewResponse,
  SearchHit,
  SearchResponse,
  TrackArtist,
} from '../src/catalog';

describe('catalog domain schemas', () => {
  test('EntityType enum covers track/album/artist/playlist', () => {
    const types = ['track', 'album', 'artist', 'playlist'] as const;
    for (const t of types) {
      expect(EntityType.parse(t)).toBe(t);
    }
    expect(() => EntityType.parse('episode')).toThrow();
  });

  test('TrackArtist requires id/name/uri', () => {
    const a = TrackArtist.parse({ id: 'a1', name: 'A', uri: 'spotify:artist:a1' });
    expect(a.name).toBe('A');
    expect(() => TrackArtist.parse({ id: 'a1', name: 'A' })).toThrow();
  });

  test('CatalogTrack requires at least one artist and a non-negative duration', () => {
    const good = CatalogTrack.parse({
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'T',
      artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
      durationMs: 240_000,
    });
    expect(good.durationMs).toBe(240_000);

    expect(() =>
      CatalogTrack.parse({
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'T',
        artists: [],
        durationMs: 0,
      }),
    ).toThrow();
    expect(() =>
      CatalogTrack.parse({
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'T',
        artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
        durationMs: -1,
      }),
    ).toThrow();
  });

  test('CatalogAlbum requires at least one artist', () => {
    expect(() =>
      CatalogAlbum.parse({ id: 'a1', uri: 'spotify:album:a1', name: 'A', artists: [] }),
    ).toThrow();
    const a = CatalogAlbum.parse({
      id: 'a1',
      uri: 'spotify:album:a1',
      name: 'A',
      artists: [{ id: 'ar1', name: 'AR', uri: 'spotify:artist:ar1' }],
    });
    expect(a.albumType).toBeUndefined();
  });

  test('CatalogArtist accepts empty genres/followers', () => {
    const a = CatalogArtist.parse({ id: 'a1', uri: 'spotify:artist:a1', name: 'A' });
    expect(a.genres).toBeUndefined();
    expect(a.followers).toBeUndefined();
  });

  test('CatalogPlaylist with owner and image', () => {
    const p = CatalogPlaylist.parse({
      id: 'p1',
      uri: 'spotify:playlist:p1',
      name: 'P',
      owner: { id: 'o1', name: 'O' },
      trackCount: 0,
    });
    expect(p.isPublic).toBeUndefined();
  });

  test('SearchHit type discriminator requires matching field', () => {
    const hit = SearchHit.parse({
      type: 'track',
      track: {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'T',
        artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
        durationMs: 1,
      },
    });
    expect(hit.type).toBe('track');

    expect(() =>
      SearchHit.parse({
        type: 'track',
        album: {
          id: 'a1',
          uri: 'spotify:album:a1',
          name: 'A',
          artists: [{ id: 'ar1', name: 'AR', uri: 'spotify:artist:ar1' }],
        },
      }),
    ).toThrow();
  });

  test('SearchResponse with hits and error path', () => {
    const ok = SearchResponse.parse({ query: 'foo', hits: [] });
    expect(ok.hits).toEqual([]);
    const err = SearchResponse.parse({
      query: 'foo',
      hits: [],
      error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
    });
    expect(err.error?.code).toBe('RATE_LIMITED');
  });

  test('EntityViewResponse discriminated union selects matching branch', () => {
    const track = EntityViewResponse.parse({
      type: 'track',
      track: {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'T',
        artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
        durationMs: 1,
      },
      completeness: 'complete',
    });
    expect(track.type).toBe('track');

    const album = EntityViewResponse.parse({
      type: 'album',
      album: {
        id: 'a1',
        uri: 'spotify:album:a1',
        name: 'A',
        artists: [{ id: 'ar1', name: 'AR', uri: 'spotify:artist:ar1' }],
      },
      completeness: 'partial',
      reason: 'spotify-policy',
    });
    expect(album.type).toBe('album');
    expect(album.completeness).toBe('partial');
  });
});
