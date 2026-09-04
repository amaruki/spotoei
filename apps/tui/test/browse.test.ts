import { describe, expect, it } from 'bun:test';

import { buildBrowseCategories, DEFAULT_BROWSE_CONFIG } from '../src/browse';

describe('buildBrowseCategories', () => {
  it('returns all 10 default categories with empty config', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    expect(cats.length).toBe(10);
    const ids = cats.map((c) => c.id);
    expect(ids).toContain('discover');
    expect(ids).toContain('charts');
    expect(ids).toContain('new_releases');
    expect(ids).toContain('moods');
    expect(ids).toContain('activities');
    expect(ids).toContain('in_the_car');
    expect(ids).toContain('genres');
    expect(ids).toContain('decades');
    expect(ids).toContain('editorial');
    expect(ids).toContain('search_all');
  });

  it('renders charts as disabled placeholder when config has no charts', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const charts = cats.find((c) => c.id === 'charts');
    expect(charts).toBeDefined();
    expect(charts?.entries[0]?.id).toBe('charts_unconfigured');
    expect(charts?.entries[0]?.enabled).toBe(false);
  });

  it('renders user-configured charts as enabled entries', () => {
    const cats = buildBrowseCategories({
      charts: [
        { id: 'us', label: 'US Top 50', countryCode: 'US', playlistUri: 'spotify:playlist:us' },
        { id: 'global', label: 'Global Top 50', playlistUri: 'spotify:playlist:g' },
      ],
      editorialPlaylists: [],
      drivingPlaylistUris: [],
    });
    const charts = cats.find((c) => c.id === 'charts');
    expect(charts?.entries.length).toBe(2);
    expect(charts?.entries[0]?.id).toBe('us');
    expect(charts?.entries[0]?.enabled).toBe(true);
    expect(charts?.entries[0]?.source.kind).toBe('playlist');
    expect(charts?.entries[1]?.id).toBe('global');
  });

  it('includes driving playlists as 1-indexed pins in in_the_car', () => {
    const cats = buildBrowseCategories({
      charts: [],
      editorialPlaylists: [],
      drivingPlaylistUris: ['spotify:playlist:a', 'spotify:playlist:b'],
    });
    const car = cats.find((c) => c.id === 'in_the_car');
    expect(car).toBeDefined();
    const pin1 = car?.entries.find((e) => e.id === 'driving_pin_1');
    const pin2 = car?.entries.find((e) => e.id === 'driving_pin_2');
    expect(pin1?.source.kind).toBe('playlist');
    expect(pin1?.source.kind === 'playlist' && pin1?.source.playlistUri).toBe('spotify:playlist:a');
    expect(pin2?.source.kind === 'playlist' && pin2?.source.playlistUri).toBe('spotify:playlist:b');
  });

  it('includes the resume queue action entry first in in_the_car', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const car = cats.find((c) => c.id === 'in_the_car');
    expect(car?.entries[0]?.id).toBe('resume_queue');
    expect(car?.entries[0]?.source.kind).toBe('action');
    if (car?.entries[0]?.source.kind === 'action') {
      expect(car.entries[0].source.action).toBe('resume_queue');
    }
  });

  it('renders editorial as disabled placeholder when config has no editorial', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const editorial = cats.find((c) => c.id === 'editorial');
    expect(editorial?.entries[0]?.id).toBe('editorial_unconfigured');
    expect(editorial?.entries[0]?.enabled).toBe(false);
  });

  it('renders user-configured editorial playlists as enabled', () => {
    const cats = buildBrowseCategories({
      charts: [],
      editorialPlaylists: [{ id: 'p1', label: 'Mint', playlistUri: 'spotify:playlist:m1' }],
      drivingPlaylistUris: [],
    });
    const editorial = cats.find((c) => c.id === 'editorial');
    expect(editorial?.entries[0]?.id).toBe('p1');
    expect(editorial?.entries[0]?.enabled).toBe(true);
  });

  it('search_all has 4 entity-type entries', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const search = cats.find((c) => c.id === 'search_all');
    expect(search?.entries.length).toBe(4);
    const types = search?.entries.map((e) => {
      const src = e.source;
      return src.kind === 'search' ? src.types : [];
    });
    expect(types?.[0]).toContain('track');
    expect(types?.[1]).toContain('album');
    expect(types?.[2]).toContain('artist');
    expect(types?.[3]).toContain('playlist');
  });

  it('discover entry search_all uses wildcard query *', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const discover = cats.find((c) => c.id === 'discover');
    const all = discover?.entries.find((e) => e.id === 'search_all');
    expect(all?.source.kind).toBe('search');
    if (all?.source.kind === 'search') {
      expect(all.source.query).toBe('*');
    }
  });

  it('static browse categories have enabled entries', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    for (const id of [
      'discover',
      'new_releases',
      'moods',
      'activities',
      'genres',
      'decades',
      'search_all',
    ]) {
      const c = cats.find((x) => x.id === id);
      expect(c).toBeDefined();
      expect(c?.entries.length).toBeGreaterThan(0);
      for (const e of c?.entries ?? []) {
        expect(e.enabled).toBe(true);
      }
    }
  });
});
