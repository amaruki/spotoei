import { describe, expect, test } from 'bun:test';
import type { CatalogTrackT } from 'spotoei-protocol';

import { endLooksGenuine } from '../src/main/listeners';

const track = (id: string, durationMs = 180000): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  durationMs,
});

const stateWith = (pool: CatalogTrackT[]) =>
  ({
    activePlaylistTracks: pool,
    libraryItems: [],
  }) as unknown as Parameters<typeof endLooksGenuine>[1];

describe('endLooksGenuine', () => {
  test('rejects a stale position-0 idle', () => {
    const state = stateWith([track('t1')]);
    expect(endLooksGenuine({ track: { uri: 'spotify:track:t1' }, positionMs: 0 }, state)).toBe(
      false,
    );
  });

  test('accepts idle at the known track end', () => {
    const state = stateWith([track('t1')]);
    expect(endLooksGenuine({ track: { uri: 'spotify:track:t1' }, positionMs: 179500 }, state)).toBe(
      true,
    );
  });

  test('rejects mid-track idle for known durations', () => {
    const state = stateWith([track('t1')]);
    expect(endLooksGenuine({ track: { uri: 'spotify:track:t1' }, positionMs: 10_000 }, state)).toBe(
      false,
    );
  });

  test('accepts long playback without known metadata', () => {
    const state = stateWith([]);
    expect(endLooksGenuine({ track: { uri: 'spotify:track:x' }, positionMs: 31_000 }, state)).toBe(
      true,
    );
  });

  test('rejects short playback without known metadata', () => {
    const state = stateWith([]);
    expect(endLooksGenuine({ track: { uri: 'spotify:track:x' }, positionMs: 4000 }, state)).toBe(
      false,
    );
  });

  test('finds durations in the library fallback pool', () => {
    const state = {
      activePlaylistTracks: [],
      libraryItems: [track('lib1', 200000)],
    } as unknown as Parameters<typeof endLooksGenuine>[1];
    expect(
      endLooksGenuine({ track: { uri: 'spotify:track:lib1' }, positionMs: 199000 }, state),
    ).toBe(true);
  });
});
