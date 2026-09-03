import { describe, expect, it } from 'bun:test';
import {
  albumTrackOptions,
  artistAlbumOptions,
  playlistTrackOptions,
} from '../src/ui/views/entities';
import { browseCategoryOptions, browseEntryOptions } from '../src/ui/views/browseView';
import { contextActionsFor } from '../src/contextActions';

describe('entity view formatters', () => {
  it('formats album tracks with index and duration', () => {
    const opts = albumTrackOptions([
      {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'Track One',
        artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
        durationMs: 222000,
      },
    ]);
    expect(opts[0]?.name).toContain('01.');
    expect(opts[0]?.name).toContain('Track One');
    expect(opts[0]?.description).toContain('3:42');
  });

  it('formats artist albums with year', () => {
    const opts = artistAlbumOptions([
      {
        id: 'al1',
        uri: 'spotify:album:al1',
        name: 'Album Title',
        artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
        releaseDate: '2024-05-01',
      },
    ]);
    expect(opts[0]?.name).toContain('Album Title');
    expect(opts[0]?.description).toContain('2024');
  });

  it('formats playlist tracks with artist', () => {
    const opts = playlistTrackOptions([
      {
        id: 't2',
        uri: 'spotify:track:t2',
        name: 'Song',
        artists: [{ id: 'a', name: 'Singer', uri: 'spotify:artist:a' }],
        durationMs: 190000,
      },
    ]);
    expect(opts[0]?.description).toContain('Singer');
  });
});

describe('browse view formatters', () => {
  it('formats categories and entries as selectable options', () => {
    const cats = browseCategoryOptions([{ id: 'moods', label: 'Moods', entries: [] }]);
    expect(cats[0]?.name).toContain('Moods');
    const entries = browseEntryOptions([
      {
        id: 'chill',
        label: 'Chill',
        description: 'Relaxed',
        enabled: true,
        source: { kind: 'search', query: 'chill', types: ['playlist'] },
      },
    ]);
    expect(entries[0]?.name).toContain('Chill');
  });

  it('marks disabled entries as unavailable', () => {
    const entries = browseEntryOptions([
      {
        id: 'charts_unconfigured',
        label: 'No Charts Configured',
        description: 'Add URIs in Settings',
        enabled: false,
        source: { kind: 'playlist', playlistUri: '' },
      },
    ]);
    expect(entries[0]?.description).toContain('Settings');
  });
});

describe('context actions', () => {
  it('exposes track primary and secondary actions', () => {
    const actions = contextActionsFor('track');
    expect(actions.primary).toBe('play');
    expect(actions.secondary).toContain('play_next');
    expect(actions.secondary).toContain('like');
  });

  it('exposes playlist pin action and album save action', () => {
    expect(contextActionsFor('playlist').secondary).toContain('pin_driving');
    expect(contextActionsFor('album').secondary).toContain('save');
  });

  it('enter maps to primary action only', () => {
    for (const kind of ['track', 'artist', 'album', 'playlist'] as const) {
      const a = contextActionsFor(kind);
      expect(typeof a.primary).toBe('string');
      expect(a.secondary).not.toContain(a.primary);
    }
  });
});
