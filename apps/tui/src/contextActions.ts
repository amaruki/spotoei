// Context-action menu (x) + palette mapping. Enter always runs primary.

export type EntityActionKind = 'track' | 'artist' | 'album' | 'playlist';

export interface ContextActions {
  primary: string;
  secondary: string[];
}

const ACTIONS: Record<EntityActionKind, ContextActions> = {
  track: {
    primary: 'play',
    secondary: ['play_next', 'queue', 'like', 'unlike', 'open_artist', 'open_album'],
  },
  artist: {
    primary: 'play',
    secondary: ['follow', 'unfollow', 'open_spotify'],
  },
  album: {
    primary: 'play',
    secondary: ['save', 'remove', 'open_artist', 'open_spotify'],
  },
  playlist: {
    primary: 'play',
    secondary: ['save', 'remove', 'pin_driving', 'open_spotify'],
  },
};

export function contextActionsFor(kind: EntityActionKind): ContextActions {
  return ACTIONS[kind];
}
