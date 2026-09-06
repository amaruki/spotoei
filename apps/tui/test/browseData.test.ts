import { describe, expect, it } from 'bun:test';

import {
  ACTIVITIES_ENTRIES,
  DECADES_ENTRIES,
  DISCOVER_ENTRIES,
  GENRES_ENTRIES,
  MOODS_ENTRIES,
  NEW_RELEASES_ENTRIES,
} from '../src/browse/data';

describe('DISCOVER_ENTRIES', () => {
  it('contains top_artists and new_releases', () => {
    const ids = DISCOVER_ENTRIES.map((e) => e.id);
    expect(ids).toContain('top_artists');
    expect(ids).toContain('new_releases');
  });

  it('all entries are enabled', () => {
    for (const e of DISCOVER_ENTRIES) {
      expect(e.enabled).toBe(true);
    }
  });
});

describe('NEW_RELEASES_ENTRIES', () => {
  it('contains new_albums and new_singles', () => {
    const ids = NEW_RELEASES_ENTRIES.map((e) => e.id);
    expect(ids).toContain('new_albums');
    expect(ids).toContain('new_singles');
  });
});

describe('MOODS_ENTRIES', () => {
  it('contains chill, focus, sleep, party', () => {
    const ids = MOODS_ENTRIES.map((e) => e.id);
    expect(ids).toContain('chill');
    expect(ids).toContain('focus');
    expect(ids).toContain('sleep');
    expect(ids).toContain('party');
  });
});

describe('ACTIVITIES_ENTRIES', () => {
  it('contains gaming, cooking, workout, study', () => {
    const ids = ACTIVITIES_ENTRIES.map((e) => e.id);
    expect(ids).toContain('gaming');
    expect(ids).toContain('cooking');
    expect(ids).toContain('workout');
    expect(ids).toContain('study');
  });
});

describe('GENRES_ENTRIES', () => {
  it('contains 6+ major genres including pop, rock, hiphop, electronic', () => {
    expect(GENRES_ENTRIES.length).toBeGreaterThanOrEqual(6);
    const ids = GENRES_ENTRIES.map((e) => e.id);
    expect(ids).toContain('pop');
    expect(ids).toContain('rock');
    expect(ids).toContain('hiphop');
    expect(ids).toContain('electronic');
  });
});

describe('DECADES_ENTRIES', () => {
  it('covers decades from 1980s through 2020s', () => {
    const ids = DECADES_ENTRIES.map((e) => e.id);
    expect(ids).toContain('1980s');
    expect(ids).toContain('1990s');
    expect(ids).toContain('2000s');
    expect(ids).toContain('2010s');
    expect(ids).toContain('2020s');
  });
});
