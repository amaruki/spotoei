import { describe, expect, it } from 'bun:test';
import type { BrowseEntryT, CatalogTrackT } from 'spotoei-protocol';
import {
  activateBrowseEntry,
  browseBreadcrumb,
  ensureBrowseEntry,
  ensureBrowseLevel,
  resolveBrowseSelection,
} from '../src/main/browseLoad';
import type { Ui } from '../src/ui/types';

const searchEntry = (id: string): BrowseEntryT => ({
  id,
  label: id,
  description: 'd',
  enabled: true,
  source: { kind: 'search', query: 'chill', types: ['playlist'] },
});

const track = (id: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  durationMs: 180000,
});

function stubUi(calls: string[]): Ui {
  return {
    setBrowseCategories: (cats: unknown[]) => calls.push(`cats:${cats.length}`),
    setBrowseEntries: (entries: unknown[]) => calls.push(`entries:${entries.length}`),
    setBrowseTracks: (tracks: unknown[]) => calls.push(`tracks:${tracks.length}`),
    setStatus: () => {},
  } as unknown as Ui;
}

describe('browse navigation', () => {
  it('navigates categories deeper without API calls', () => {
    const nav = resolveBrowseSelection({}, 3);
    expect(nav.kind).toBe('route');
    if (nav.kind === 'route') {
      expect(nav.route).toEqual({ kind: 'browse', path: { category: 'moods' } });
    }
  });

  it('resolves search entries to the browse entry level, never search', () => {
    const nav = resolveBrowseSelection({ category: 'moods' }, 0);
    expect(nav.kind).toBe('route');
    if (nav.kind === 'route') {
      expect(nav.route.kind).toBe('browse');
      if (nav.route.kind === 'browse') {
        expect(nav.route.path.category).toBe('moods');
        expect(nav.route.path.entry).toBeTruthy();
      }
    }
  });

  it('activates search entries as inline browse routes with notes', () => {
    const nav = activateBrowseEntry(searchEntry('chill'));
    expect(nav.kind).toBe('route');
    if (nav.kind === 'route') {
      expect(nav.route.kind).toBe('browse');
    }
  });

  it('routes playlist, library, top-artist and queue sources', () => {
    const playlist: BrowseEntryT = {
      ...searchEntry('p'),
      source: { kind: 'playlist', playlistUri: 'spotify:playlist:abc' },
    };
    expect(activateBrowseEntry(playlist)).toMatchObject({
      kind: 'route',
      route: { kind: 'playlist', id: 'abc' },
    });
    const library: BrowseEntryT = {
      ...searchEntry('l'),
      source: { kind: 'library', collection: 'playlists' },
    };
    expect(activateBrowseEntry(library)).toMatchObject({
      kind: 'route',
      route: { kind: 'library' },
    });
    const top: BrowseEntryT = { ...searchEntry('t'), source: { kind: 'top_artists' } };
    expect(activateBrowseEntry(top)).toMatchObject({ kind: 'route', route: { kind: 'home' } });
    const action: BrowseEntryT = {
      ...searchEntry('q'),
      source: { kind: 'action', action: 'resume_queue' },
    };
    expect(activateBrowseEntry(action)).toMatchObject({ kind: 'route', route: { kind: 'queue' } });
  });

  it('disabled entries explain themselves and never route', () => {
    const nav = activateBrowseEntry({
      ...searchEntry('x'),
      label: 'No Charts Configured',
      enabled: false,
      source: { kind: 'playlist', playlistUri: '' },
    });
    expect(nav.kind).toBe('message');
    if (nav.kind === 'message') {
      expect(nav.text).toContain('Settings');
      expect(nav.persist).toBe(true);
    }
  });

  it('rejects invalid playlist references without crashing', () => {
    const nav = activateBrowseEntry({
      ...searchEntry('bad'),
      source: { kind: 'playlist', playlistUri: '' },
      enabled: true,
    });
    expect(nav.kind).toBe('message');
  });

  it('builds breadcrumb trails for category and entry levels', () => {
    expect(browseBreadcrumb({})).toBe('Browse');
    expect(browseBreadcrumb({ category: 'moods' })).toBe('Browse › Moods');
    expect(browseBreadcrumb({ category: 'moods', entry: 'chill' })).toContain('Chill');
  });

  it('renders category and entry levels into the browse list', () => {
    const calls: string[] = [];
    const ui = stubUi(calls);
    ensureBrowseLevel(ui, {});
    ensureBrowseLevel(ui, { category: 'moods' });
    expect(calls[0]?.startsWith('cats:')).toBe(true);
    expect(Number(calls[0]?.split(':')[1])).toBeGreaterThan(5);
    expect(Number(calls[1]?.split(':')[1])).toBeGreaterThanOrEqual(5);
  });

  it('renders search entries inline as tracks without leaving browse', async () => {
    const calls: string[] = [];
    const ui = stubUi(calls);
    const ok = await ensureBrowseEntry(
      ui,
      { category: 'moods', entry: 'chill' },
      {
        entityManager: {
          loadNewReleases: async () => [],
          loadRecommendations: async () => [],
        },
        searchClient: {
          search: async () => ({
            query: 'chill',
            hits: [{ type: 'track', track: track('t1') }],
          }),
        },
      },
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(['tracks:1']);
  });
});
