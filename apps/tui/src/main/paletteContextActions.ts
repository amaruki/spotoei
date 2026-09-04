// Context actions mirrored into the Command Palette. Each command
// resolves the current context target at action time and runs it through
// the shared runner, so palette entries behave exactly like the x menu.

import type { ContextTarget } from '../ui/types';
import type { PaletteCommand } from './paletteCommands';

type TargetResolver = () => ContextTarget | null;
type ActionRunner = (action: string, target: ContextTarget) => void;

interface MirroredAction {
  name: string;
  kinds: Array<ContextTarget['kind']>;
  action: string;
}

const MIRRORED: MirroredAction[] = [
  { name: 'Track: Play', kinds: ['track'], action: 'play' },
  { name: 'Track: Add to queue', kinds: ['track'], action: 'queue' },
  { name: 'Track: Like', kinds: ['track'], action: 'like' },
  { name: 'Track: Unlike', kinds: ['track'], action: 'unlike' },
  { name: 'Track: Open artist', kinds: ['track'], action: 'open_artist' },
  { name: 'Track: Open album', kinds: ['track'], action: 'open_album' },
  { name: 'Artist: Play', kinds: ['artist'], action: 'play' },
  { name: 'Artist: Follow', kinds: ['artist'], action: 'follow' },
  { name: 'Artist: Unfollow', kinds: ['artist'], action: 'unfollow' },
  { name: 'Artist: Open in Spotify', kinds: ['artist'], action: 'open_spotify' },
  { name: 'Album: Play', kinds: ['album'], action: 'play' },
  { name: 'Album: Save', kinds: ['album'], action: 'save' },
  { name: 'Album: Remove', kinds: ['album'], action: 'remove' },
  { name: 'Album: Open artist', kinds: ['album'], action: 'open_artist' },
  { name: 'Album: Open in Spotify', kinds: ['album'], action: 'open_spotify' },
  { name: 'Playlist: Play', kinds: ['playlist'], action: 'play' },
  { name: 'Playlist: Save', kinds: ['playlist'], action: 'save' },
  { name: 'Playlist: Remove', kinds: ['playlist'], action: 'remove' },
  { name: 'Playlist: Pin for driving', kinds: ['playlist'], action: 'pin_driving' },
  { name: 'Playlist: Open in Spotify', kinds: ['playlist'], action: 'open_spotify' },
];

export function contextActionCommands(
  getTarget: TargetResolver,
  run: ActionRunner,
  notify: (msg: string) => void,
): PaletteCommand[] {
  return MIRRORED.map((m) => ({
    name: m.name,
    description: 'x menu',
    action: () => {
      const target = getTarget();
      if (!target || !m.kinds.includes(target.kind)) {
        notify(`No matching item selected for "${m.name}"`);
        return;
      }
      run(m.action, target);
    },
  }));
}
