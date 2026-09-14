import type { ContextMenuItem, ContextTarget, Ui } from '../ui/types';
import { runContextAction, type ContextActionDeps } from './contextActionRunner';

function item(
  label: string,
  hint: string,
  run: () => void,
  extra?: Partial<ContextMenuItem>,
): ContextMenuItem {
  return { label, hint, run, ...extra };
}

// Assemble the x-menu opener: resolves runners against live clients and
// opens the overlay. Browse entries open with Enter (Phase 8 loaders).
export function createMenuOpener(
  ctx: ContextActionDeps,
  getUi: () => Ui | null,
): (target: ContextTarget) => void {
  return (target) => {
    const ui = getUi();
    if (!ui) return;
    if (target.kind === 'browse-entry') {
      ui.setStatus(`Open ${target.name} with Enter`);
      return;
    }
    const run = (action: string): void => {
      void runContextAction(ctx, getUi, action, target);
    };
    ui.openContextMenu(target.name, buildContextMenuItems(run, target));
  };
}

// Build overlay items for a target. "Play next" is intentionally absent:
// the queue API only appends, and labeling append as "next" would lie.
export function buildContextMenuItems(
  run: (action: string) => void,
  target: ContextTarget,
): ContextMenuItem[] {
  switch (target.kind) {
    case 'track':
      return [
        item('Play', 'Enter', () => run('play')),
        item('Start Song Radio', 'x menu', () => run('song_radio')),
        item('Start Artist Radio', 'x menu', () => run('artist_radio')),
        item('Add to queue', 'x menu', () => run('queue')),
        item('Like', 'x menu', () => run('like')),
        item('Unlike', 'x menu', () => run('unlike')),
        item('Add to playlist', 'x menu', () => run('add_to_playlist')),
        item('Remove from playlist', 'x menu', () => run('remove_from_playlist')),
        item('Go to artist', 'x menu', () => run('open_artist')),
        item('Go to album', 'x menu', () => run('open_album')),
        item('Open in Spotify', 'x menu', () => run('open_spotify')),
        item('Copy Spotify URI', 'x menu', () => run('copy_uri')),
      ];
    case 'artist':
      return [
        item('Play', 'Enter', () => run('play')),
        item('Start Artist Radio', 'x menu', () => run('artist_radio')),
        item('Follow', 'x menu', () => run('follow')),
        item('Unfollow', 'x menu', () => run('unfollow')),
        item('Open in Spotify', 'x menu', () => run('open_spotify')),
        item('Copy Spotify URI', 'x menu', () => run('copy_uri')),
      ];
    case 'album':
      return [
        item('Play', 'Enter', () => run('play')),
        item('Save', 'x menu', () => run('save')),
        item('Remove', 'x menu', () => run('remove')),
        item('Go to artist', 'x menu', () => run('open_artist')),
        item('Open in Spotify', 'x menu', () => run('open_spotify')),
        item('Copy Spotify URI', 'x menu', () => run('copy_uri')),
      ];
    case 'playlist':
      return [
        item('Play', 'Enter', () => run('play')),
        item('Save', 'x menu', () => run('save')),
        item('Remove', 'x menu', () => run('remove')),
        item('Pin for driving', 'x menu', () => run('pin_driving')),
        item('Open in Spotify', 'x menu', () => run('open_spotify')),
        item('Copy Spotify URI', 'x menu', () => run('copy_uri')),
      ];
    case 'browse-entry':
      return [item('Open', 'Enter', () => run('open'))];
  }
}
