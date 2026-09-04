import { describe, expect, it } from 'bun:test';
import type { CatalogArtistT, CatalogPlaylistT, CatalogTrackT } from 'spotoei-protocol';

import { libraryItemOptions } from '../src/ui/views/library';

describe('libraryItemOptions', () => {
  it('renders error message when error is present', () => {
    const options = libraryItemOptions([], {
      code: 'AUTH_EXPIRED',
      message: 'Token expired',
    });
    expect(options).toEqual([
      { name: '⚠ Library Error: AUTH_EXPIRED', description: 'Token expired' },
    ]);
  });

  it('renders empty placeholder when items list is empty', () => {
    const options = libraryItemOptions([]);
    expect(options).toEqual([
      {
        name: '(library empty)',
        description: 'No saved tracks found. Save songs on Spotify or press r to refresh.',
      },
    ]);
  });

  it('formats track items with music note prefix and artists/album description', () => {
    const track: CatalogTrackT = {
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Test Song',
      artists: [{ id: 'a1', name: 'Singer', uri: 'spotify:artist:a1' }],
      albumName: 'Album 1',
      durationMs: 180_000,
    };
    const options = libraryItemOptions([track]);
    expect(options).toEqual([
      {
        name: '♪ Test Song',
        description: 'Singer — Album 1',
      },
    ]);
  });

  it('formats artist items with person icon and follower count', () => {
    const artist: CatalogArtistT = {
      id: 'a1',
      uri: 'spotify:artist:a1',
      name: 'Cool Artist',
      followers: 12500,
    };
    const options = libraryItemOptions([artist]);
    expect(options).toEqual([
      {
        name: '👤 Cool Artist',
        description: '12500 followers (artist)',
      },
    ]);
  });

  it('formats playlist items with menu icon and track count', () => {
    const playlist: CatalogPlaylistT = {
      id: 'p1',
      uri: 'spotify:playlist:p1',
      name: 'Road Trip',
      trackCount: 42,
    };
    const options = libraryItemOptions([playlist]);
    expect(options).toEqual([
      {
        name: '☰ Road Trip',
        description: '42 tracks (playlist)',
      },
    ]);
  });
});
