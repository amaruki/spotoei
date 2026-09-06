// Per-collection Library state: selection, scroll, paging, loading, error.
// r refreshes the active collection only; failure preserves loaded content.

import type { CatalogPlaylistT, LibraryCollectionT } from 'spotoei-protocol';

export type PlaylistT = CatalogPlaylistT;

export interface PlaylistFolderNode {
  id: string;
  name: string;
  children: Array<PlaylistFolderNode | PlaylistT>;
  isExpanded: boolean;
  uri?: string;
  depth?: number;
}

export type PlaylistFolderItem = (PlaylistFolderNode | PlaylistT) & { depth?: number };

export function isPlaylistFolderNode(item: unknown): item is PlaylistFolderNode {
  return (
    typeof item === 'object' &&
    item !== null &&
    'children' in item &&
    Array.isArray((item as PlaylistFolderNode).children) &&
    'isExpanded' in item &&
    typeof (item as PlaylistFolderNode).isExpanded === 'boolean'
  );
}

export interface StructurizeOptions {
  delimiters?: Array<string | RegExp>;
  defaultExpanded?: boolean;
}

const DEFAULT_DELIMITERS = [/\s+\/\s+/, /\s*::\s*/, /\s*\\\s*/, /\//];

function splitPath(name: string, delimiters: Array<string | RegExp>): string[] {
  for (const delim of delimiters) {
    const parts = name.split(delim).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts;
    }
  }
  return [name.trim()];
}

function extractFolderPath(
  item: PlaylistT | PlaylistFolderNode,
  delimiters: Array<string | RegExp>,
): { folders: string[]; leafName: string } {
  const raw = item as Record<string, unknown>;
  if (Array.isArray(raw.folder)) {
    const folders = raw.folder.map(String).map((s) => s.trim()).filter(Boolean);
    return { folders, leafName: item.name };
  }
  if (typeof raw.folder === 'string' && raw.folder.trim().length > 0) {
    const folders = splitPath(raw.folder, delimiters);
    return { folders, leafName: item.name };
  }
  if (typeof raw.folderName === 'string' && raw.folderName.trim().length > 0) {
    return { folders: [raw.folderName.trim()], leafName: item.name };
  }
  if (typeof raw.path === 'string' && raw.path.trim().length > 0) {
    const parts = splitPath(raw.path, delimiters);
    if (parts.length > 1) {
      return { folders: parts.slice(0, -1), leafName: parts[parts.length - 1]! };
    }
    return { folders: [parts[0]!], leafName: item.name };
  }

  const parts = splitPath(item.name, delimiters);
  if (parts.length > 1) {
    return { folders: parts.slice(0, -1), leafName: parts[parts.length - 1]! };
  }
  return { folders: [], leafName: item.name };
}

export function structurizePlaylists(
  playlists: Array<PlaylistT | PlaylistFolderNode>,
  options?: StructurizeOptions,
): Array<PlaylistFolderNode | PlaylistT> {
  const delimiters = options?.delimiters ?? DEFAULT_DELIMITERS;
  const defaultExpanded = options?.defaultExpanded ?? false;
  const root: Array<PlaylistFolderNode | PlaylistT> = [];

  const findOrCreateFolder = (
    container: Array<PlaylistFolderNode | PlaylistT>,
    folderName: string,
    currentPath: string,
  ): PlaylistFolderNode => {
    const existing = container.find(
      (node): node is PlaylistFolderNode => isPlaylistFolderNode(node) && node.name === folderName,
    );
    if (existing) return existing;

    const folderId = `folder:${currentPath}`;
    const newFolder: PlaylistFolderNode = {
      id: folderId,
      name: folderName,
      children: [],
      isExpanded: defaultExpanded,
      uri: folderId,
    };
    container.push(newFolder);
    return newFolder;
  };

  for (const item of playlists) {
    if (isPlaylistFolderNode(item)) {
      root.push(item);
      continue;
    }

    const { folders, leafName } = extractFolderPath(item, delimiters);
    if (folders.length === 0) {
      root.push(item);
      continue;
    }

    let currentContainer = root;
    let pathAcc = '';
    for (const seg of folders) {
      pathAcc = pathAcc ? `${pathAcc}/${seg}` : seg;
      const folder = findOrCreateFolder(currentContainer, seg, pathAcc);
      currentContainer = folder.children;
    }

    const leafPlaylist: PlaylistT = {
      ...item,
      name: leafName,
    };
    currentContainer.push(leafPlaylist);
  }

  return root;
}

export function toggleFolderExpanded(
  nodes: Array<PlaylistFolderNode | PlaylistT>,
  folderId: string,
): Array<PlaylistFolderNode | PlaylistT> {
  return nodes.map((node) => {
    if (!isPlaylistFolderNode(node)) return node;
    if (node.id === folderId) {
      return {
        ...node,
        isExpanded: !node.isExpanded,
      };
    }
    return {
      ...node,
      children: toggleFolderExpanded(node.children, folderId),
    };
  });
}

export function setFolderExpanded(
  nodes: Array<PlaylistFolderNode | PlaylistT>,
  folderId: string,
  isExpanded: boolean,
): Array<PlaylistFolderNode | PlaylistT> {
  return nodes.map((node) => {
    if (!isPlaylistFolderNode(node)) return node;
    if (node.id === folderId) {
      return {
        ...node,
        isExpanded,
      };
    }
    return {
      ...node,
      children: setFolderExpanded(node.children, folderId, isExpanded),
    };
  });
}

export function flattenPlaylistTree(
  nodes: Array<PlaylistFolderNode | PlaylistT>,
  depth = 0,
): PlaylistFolderItem[] {
  const result: PlaylistFolderItem[] = [];
  for (const node of nodes) {
    if (isPlaylistFolderNode(node)) {
      result.push({ ...node, depth });
      if (node.isExpanded) {
        result.push(...flattenPlaylistTree(node.children, depth + 1));
      }
    } else {
      result.push({ ...node, depth } as PlaylistT);
    }
  }
  return result;
}

export interface CollectionState {
  selected: number;
  scroll: number;
  nextOffset: number;
  nextCursor?: string;
  total?: number;
  hasMore: boolean;
  loading: boolean;
  lastError?: string;
}

export type CollectionMap = Record<LibraryCollectionT, CollectionState>;

export function initialCollectionState(): CollectionState {
  return { selected: 0, scroll: 0, nextOffset: 0, hasMore: true, loading: false };
}

export function initialCollections(): CollectionMap {
  return {
    saved_tracks: initialCollectionState(),
    saved_albums: initialCollectionState(),
    followed_artists: initialCollectionState(),
    playlists: initialCollectionState(),
    saved_shows: initialCollectionState(),
  };
}

export function markRefreshFailed(
  map: CollectionMap,
  collection: LibraryCollectionT,
  message: string,
): CollectionMap {
  return {
    ...map,
    [collection]: { ...map[collection], loading: false, lastError: message },
  };
}

export function markPageLoaded(
  map: CollectionMap,
  collection: LibraryCollectionT,
  nextOffset: number,
  hasMore: boolean,
  nextCursor?: string,
  total?: number,
): CollectionMap {
  return {
    ...map,
    [collection]: {
      ...map[collection],
      nextOffset,
      nextCursor,
      total: total ?? map[collection].total,
      hasMore,
      loading: false,
      lastError: undefined,
    },
  };
}

export function setCollectionLoading(
  map: CollectionMap,
  collection: LibraryCollectionT,
  loading: boolean,
): CollectionMap {
  return { ...map, [collection]: { ...map[collection], loading } };
}

export function resetCollection(map: CollectionMap, collection: LibraryCollectionT): CollectionMap {
  return {
    ...map,
    [collection]: { ...initialCollectionState(), lastError: map[collection].lastError },
  };
}

export function activeRefreshTarget(active: LibraryCollectionT): LibraryCollectionT {
  return active;
}
