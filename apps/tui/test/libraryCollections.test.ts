import { describe, expect, it } from 'bun:test';
import {
  activeRefreshTarget,
  initialCollections,
  markRefreshFailed,
} from '../src/library/collections';

describe('library collections', () => {
  it('tracks four independent collection states', () => {
    const map = initialCollections();
    map.saved_tracks.selected = 3;
    expect(map.saved_albums.selected).toBe(0);
    expect(map.playlists.selected).toBe(0);
  });

  it('r refresh targets the active collection only', () => {
    expect(activeRefreshTarget('playlists')).toBe('playlists');
    expect(activeRefreshTarget('saved_albums')).toBe('saved_albums');
  });

  it('failed refresh preserves position and records inline error', () => {
    let map = initialCollections();
    map = { ...map, saved_tracks: { ...map.saved_tracks, selected: 5, scroll: 80 } };
    map = markRefreshFailed(map, 'saved_tracks', 'NETWORK_ERROR');
    expect(map.saved_tracks.selected).toBe(5);
    expect(map.saved_tracks.scroll).toBe(80);
    expect(map.saved_tracks.lastError).toBe('NETWORK_ERROR');
    expect(map.saved_albums.lastError).toBeUndefined();
  });
});
