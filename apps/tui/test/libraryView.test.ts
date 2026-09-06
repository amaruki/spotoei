import { describe, expect, it } from 'bun:test';
import type { CatalogArtistT, CatalogPlaylistT, CatalogTrackT } from 'spotoei-protocol';

import { libraryItemOptions, toggleLibraryFolder } from '../src/ui/views/library';
import type { PlaylistFolderNode } from '../src/library/collections';

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
    expect(options[0]?.name).toBe('♪ Test Song');
    expect(options[0]?.description).toContain('Singer — Album 1');
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

  it('formats playlist folder nodes (collapsed and expanded) and indented items', () => {
    const folder: PlaylistFolderNode = {
      id: 'folder:Rock',
      name: 'Rock',
      children: [
        { id: 'p1', uri: 'spotify:playlist:p1', name: 'Classic', trackCount: 10 },
      ],
      isExpanded: false,
    };

    const collapsedOptions = libraryItemOptions([folder]);
    expect(collapsedOptions[0]?.name).toBe('📁 Rock');
    expect(collapsedOptions[0]?.description).toContain('1 item (folder · collapsed)');

    const expandedFolder: PlaylistFolderNode = {
      ...folder,
      isExpanded: true,
    };
    const indentedPlaylist = {
      id: 'p1',
      uri: 'spotify:playlist:p1',
      name: 'Classic',
      trackCount: 10,
      depth: 1,
    };
    const expandedOptions = libraryItemOptions([expandedFolder, indentedPlaylist]);
    expect(expandedOptions[0]?.name).toBe('📂 Rock');
    expect(expandedOptions[0]?.description).toContain('1 item (folder · expanded)');
    expect(expandedOptions[1]?.name).toBe('  ☰ Classic');
    expect(expandedOptions[1]?.description).toContain('10 tracks (playlist)');

    // Test toggleLibraryFolder
    const toggled = toggleLibraryFolder([folder], 'folder:Rock');
    expect((toggled[0] as PlaylistFolderNode).isExpanded).toBe(true);
  });
});
