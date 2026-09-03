// Context actions mirrored into the Command Palette (x opens palette,
// Enter runs the primary action). No-ops here; real handlers bind later.

export interface PaletteCommand {
  name: string;
  description: string;
  action: () => void;
}

export function contextActionCommands(): PaletteCommand[] {
  return [
    { name: 'Track: Play', description: 'x menu · Enter', action: () => {} },
    { name: 'Track: Play next', description: 'x menu', action: () => {} },
    { name: 'Track: Add to queue', description: 'x menu', action: () => {} },
    { name: 'Track: Like', description: 'x menu', action: () => {} },
    { name: 'Track: Unlike', description: 'x menu', action: () => {} },
    { name: 'Track: Open artist', description: 'x menu', action: () => {} },
    { name: 'Track: Open album', description: 'x menu', action: () => {} },
    { name: 'Artist: Play', description: 'x menu · Enter', action: () => {} },
    { name: 'Artist: Follow', description: 'x menu', action: () => {} },
    { name: 'Artist: Unfollow', description: 'x menu', action: () => {} },
    { name: 'Artist: Open in Spotify', description: 'x menu', action: () => {} },
    { name: 'Album: Play', description: 'x menu · Enter', action: () => {} },
    { name: 'Album: Save', description: 'x menu', action: () => {} },
    { name: 'Album: Remove', description: 'x menu', action: () => {} },
    { name: 'Album: Open artist', description: 'x menu', action: () => {} },
    { name: 'Album: Open in Spotify', description: 'x menu', action: () => {} },
    { name: 'Playlist: Play', description: 'x menu · Enter', action: () => {} },
    { name: 'Playlist: Save', description: 'x menu', action: () => {} },
    { name: 'Playlist: Remove', description: 'x menu', action: () => {} },
    { name: 'Playlist: Pin for driving', description: 'x menu', action: () => {} },
    { name: 'Playlist: Open in Spotify', description: 'x menu', action: () => {} },
  ];
}
