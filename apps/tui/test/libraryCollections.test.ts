import { describe, expect, it } from 'bun:test';
import {
  activeRefreshTarget,
  initialCollections,
  markRefreshFailed,
  structurizePlaylists,
  toggleFolderExpanded,
  setFolderExpanded,
  flattenPlaylistTree,
  isPlaylistFolderNode,
  type PlaylistFolderNode,
  type PlaylistT,
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

  it('structurizes playlists into folder hierarchy using path delimiters', () => {
    const playlists: PlaylistT[] = [
      { id: '1', uri: 'spotify:playlist:1', name: 'Rock / Classic / 70s Rock' },
      { id: '2', uri: 'spotify:playlist:2', name: 'Rock / Classic / 80s Rock' },
      { id: '3', uri: 'spotify:playlist:3', name: 'Rock / Modern' },
      { id: '4', uri: 'spotify:playlist:4', name: 'Jazz :: Smooth' },
      { id: '5', uri: 'spotify:playlist:5', name: 'Standalone' },
    ];

    const tree = structurizePlaylists(playlists);
    expect(tree.length).toBe(3); // Rock folder, Jazz folder, Standalone playlist

    const rockFolder = tree[0] as PlaylistFolderNode;
    expect(isPlaylistFolderNode(rockFolder)).toBe(true);
    expect(rockFolder.name).toBe('Rock');
    expect(rockFolder.children.length).toBe(2); // Classic folder, Modern playlist

    const classicFolder = rockFolder.children[0] as PlaylistFolderNode;
    expect(isPlaylistFolderNode(classicFolder)).toBe(true);
    expect(classicFolder.name).toBe('Classic');
    expect(classicFolder.children.length).toBe(2);
    expect((classicFolder.children[0] as PlaylistT).name).toBe('70s Rock');
    expect((classicFolder.children[1] as PlaylistT).name).toBe('80s Rock');

    const jazzFolder = tree[1] as PlaylistFolderNode;
    expect(isPlaylistFolderNode(jazzFolder)).toBe(true);
    expect(jazzFolder.name).toBe('Jazz');
    expect((jazzFolder.children[0] as PlaylistT).name).toBe('Smooth');

    const standalone = tree[2] as PlaylistT;
    expect(isPlaylistFolderNode(standalone)).toBe(false);
    expect(standalone.name).toBe('Standalone');
  });

  it('structurizes playlists using folder metadata', () => {
    const playlists = [
      { id: '1', uri: 'spotify:playlist:1', name: 'Coding Beats', folder: 'Work / Coding' },
      { id: '2', uri: 'spotify:playlist:2', name: 'Chill Vibes', folder: ['Chill', 'Acoustic'] },
      { id: '3', uri: 'spotify:playlist:3', name: 'Work Focus', folderName: 'Work' },
    ] as unknown as PlaylistT[];

    const tree = structurizePlaylists(playlists);
    expect(tree.length).toBe(2); // Work, Chill

    const workFolder = tree.find((n) => isPlaylistFolderNode(n) && n.name === 'Work') as PlaylistFolderNode;
    expect(workFolder).toBeDefined();
    expect(workFolder.children.length).toBe(2); // Coding folder, Work Focus playlist

    const chillFolder = tree.find((n) => isPlaylistFolderNode(n) && n.name === 'Chill') as PlaylistFolderNode;
    expect(chillFolder).toBeDefined();
  });

  it('toggles expand/collapse and flattens tree for UI display', () => {
    const playlists: PlaylistT[] = [
      { id: '1', uri: 'spotify:playlist:1', name: 'Metal / Heavy' },
      { id: '2', uri: 'spotify:playlist:2', name: 'Metal / Thrash' },
      { id: '3', uri: 'spotify:playlist:3', name: 'Ambient' },
    ];

    let tree = structurizePlaylists(playlists, { defaultExpanded: false });
    // Initially collapsed
    let flat = flattenPlaylistTree(tree);
    // Collapsed Metal folder + Ambient playlist
    expect(flat.length).toBe(2);
    expect(isPlaylistFolderNode(flat[0])).toBe(true);
    expect(flat[0]!.name).toBe('Metal');
    expect(flat[1]!.name).toBe('Ambient');

    // Toggle Metal folder
    const metalFolder = tree[0] as PlaylistFolderNode;
    tree = toggleFolderExpanded(tree, metalFolder.id);
    flat = flattenPlaylistTree(tree);
    // Metal (expanded) + Heavy + Thrash + Ambient
    expect(flat.length).toBe(4);
    expect((flat[0] as PlaylistFolderNode).isExpanded).toBe(true);
    expect(flat[0]!.depth).toBe(0);
    expect(flat[1]!.name).toBe('Heavy');
    expect(flat[1]!.depth).toBe(1);
    expect(flat[2]!.name).toBe('Thrash');
    expect(flat[2]!.depth).toBe(1);
    expect(flat[3]!.name).toBe('Ambient');
    expect(flat[3]!.depth).toBe(0);

    // Toggle back to collapse
    tree = toggleFolderExpanded(tree, metalFolder.id);
    flat = flattenPlaylistTree(tree);
    expect(flat.length).toBe(2);
    expect((flat[0] as PlaylistFolderNode).isExpanded).toBe(false);

    // setFolderExpanded directly
    tree = setFolderExpanded(tree, metalFolder.id, true);
    flat = flattenPlaylistTree(tree);
    expect(flat.length).toBe(4);
  });
});
