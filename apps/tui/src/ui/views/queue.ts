import { formatArtists } from '../formatters';
import type { QueueSnapshotT } from 'spotoei-protocol';

export function queueSnapshotOptions(snap: QueueSnapshotT): { name: string; description: string }[] {
  const items: { name: string; description: string }[] = [];
  if (snap.current) {
    items.push({
      name: `▶ ${snap.current.name}`,
      description: formatArtists(snap.current.artists),
    });
  }
  for (const item of snap.upcoming) {
    const track = item.track;
    items.push({
      name: track.name,
      description: `${formatArtists(track.artists)} (upcoming)`,
    });
  }
  if (items.length === 0) {
    return [{ name: '(queue empty)', description: 'Add tracks via search' }];
  }
  return items;
}
