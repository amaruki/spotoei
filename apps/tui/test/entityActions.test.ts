import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { entityRouteForHit, pinDrivingPlaylist, trackPlayInContext } from '../src/entities/actions';

describe('entity actions', () => {
  it('opens entity pages for album, artist and playlist hits', () => {
    expect(
      entityRouteForHit({
        type: 'album',
        album: { id: 'al1', uri: 'spotify:album:al1', name: 'A', artists: [] },
      } as never),
    ).toEqual({ kind: 'album', id: 'al1' });
    expect(
      entityRouteForHit({
        type: 'artist',
        artist: { id: 'ar1', uri: 'spotify:artist:ar1', name: 'A' },
      } as never),
    ).toEqual({ kind: 'artist', id: 'ar1' });
    expect(
      entityRouteForHit({
        type: 'playlist',
        playlist: { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'P' },
      } as never),
    ).toEqual({ kind: 'playlist', id: 'pl1' });
  });

  it('returns null for track hits so tracks play instead of opening', () => {
    expect(
      entityRouteForHit({
        type: 'track',
        track: { id: 't1', uri: 'spotify:track:t1', name: 'T', artists: [], durationMs: 1 },
      } as never),
    ).toBeNull();
  });

  it('plays a track in album or playlist context', () => {
    expect(trackPlayInContext('spotify:track:t1', 'spotify:album:a1')).toEqual({
      trackUri: 'spotify:track:t1',
      contextUri: 'spotify:album:a1',
    });
  });

  it('persists driving pins across restart via config file', () => {
    const path = join('/tmp', `spotoei-pin-test-${Date.now()}.json`);
    const pins = pinDrivingPlaylist('spotify:playlist:drive1', path);
    expect(pins).toContain('spotify:playlist:drive1');
    const again = pinDrivingPlaylist('spotify:playlist:drive1', path);
    expect(again.filter((p) => p === 'spotify:playlist:drive1').length).toBe(1);
  });
});
