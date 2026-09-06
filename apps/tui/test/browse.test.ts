import { describe, expect, it } from 'bun:test';

import { buildBrowseCategories, DEFAULT_BROWSE_CONFIG } from '../src/browse';

describe('buildBrowseCategories', () => {
  it('returns all 9 default categories with empty config', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    expect(cats.length).toBe(9);
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
    expect(ids).not.toContain('search_all');
  });

  it('renders working search fallback when config has no charts', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const charts = cats.find((c) => c.id === 'charts');
    expect(charts).toBeDefined();
    expect(charts!.entries.length).toBeGreaterThan(0);
    for (const e of charts!.entries) {
      expect(e.enabled).toBe(true);
      expect(e.source.kind).toBe('search');
    }
    expect(charts?.entries[0]?.id).toBe('charts_top_hits');
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

  it('renders working search fallback when config has no editorial', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const editorial = cats.find((c) => c.id === 'editorial');
    expect(editorial).toBeDefined();
    expect(editorial!.entries.length).toBeGreaterThan(0);
    for (const e of editorial!.entries) {
      expect(e.enabled).toBe(true);
      expect(e.source.kind).toBe('search');
    }
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

  it('static browse categories have enabled entries', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    for (const id of [
      'discover',
      'charts',
      'new_releases',
      'moods',
      'activities',
      'genres',
      'decades',
      'editorial',
    ]) {
      const c = cats.find((x) => x.id === id);
      expect(c).toBeDefined();
      expect(c?.entries.length).toBeGreaterThan(0);
      for (const e of c?.entries ?? []) {
        expect(e.enabled).toBe(true);
      }
    }
  });

  it('keeps the registry rich enough to feel like browse', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const count = (id: string) => cats.find((c) => c.id === id)?.entries.length ?? 0;
    expect(count('moods')).toBeGreaterThanOrEqual(10);
    expect(count('activities')).toBeGreaterThanOrEqual(8);
    expect(count('genres')).toBeGreaterThanOrEqual(10);
    expect(count('charts')).toBeGreaterThanOrEqual(3);
    expect(count('editorial')).toBeGreaterThanOrEqual(2);
    const total = cats.reduce((n, c) => n + c.entries.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it('every enabled search entry can resolve to playable rows', () => {
    // Contract with handleSearchBrowseEntryInline: a blank query redirects
    // to Search; otherwise at least one of track/playlist/album types must
    // be present (direct tracks, playlist-tracks fallback, album-tracks
    // fallback). Anything else dead-ends on "No tracks found".
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    for (const cat of cats) {
      for (const entry of cat.entries) {
        if (!entry.enabled || entry.source.kind !== 'search') continue;
        const query = entry.source.query.trim();
        const types = entry.source.types as string[];
        const renderable =
          query === '' ||
          types.includes('track') ||
          types.includes('playlist') ||
          types.includes('album');
        expect(renderable).toBe(true);
      }
    }
  });

  it('charts fallback entries carry working search queries', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const charts = cats.find((c) => c.id === 'charts');
    const queries = (charts?.entries ?? []).map((e) =>
      e.source.kind === 'search' ? e.source.query : '',
    );
    expect(queries).toEqual(['top hits', 'viral hits', 'tag:new', 'global hits']);
    for (const e of charts?.entries ?? []) {
      expect(e.enabled).toBe(true);
      if (e.source.kind === 'search') {
        expect(e.source.query.trim().length).toBeGreaterThan(0);
        expect(e.source.types.length).toBeGreaterThan(0);
      }
    }
  });

  it('editorial fallback entries carry working search queries', () => {
    const cats = buildBrowseCategories(DEFAULT_BROWSE_CONFIG);
    const editorial = cats.find((c) => c.id === 'editorial');
    const queries = (editorial?.entries ?? []).map((e) =>
      e.source.kind === 'search' ? e.source.query : '',
    );
    expect(queries).toEqual(['top albums', 'best songs', 'classic hits']);
  });
});
