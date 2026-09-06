import { formatArtists } from '../formatters';
import { STALE_PREFIX, STALE_SUFFIX } from '../theme';
import type { QueueSnapshotT } from 'spotoei-protocol';

export function queueSnapshotOptions(
  snap: QueueSnapshotT,
  opts?: { isStale?: boolean },
): { name: string; description: string }[] {
  const dim = opts?.isStale ? STALE_PREFIX : '';
  const stale = opts?.isStale ? STALE_SUFFIX : '';
  const items: { name: string; description: string }[] = [];
  if (snap.current) {
    items.push({
      name: `${dim}▶ ${snap.current.name}${stale}`,
      description: formatArtists(snap.current.artists),
    });
  }
  for (const item of snap.upcoming) {
    const track = item.track;
    items.push({
      name: `${dim}${track.name}${stale}`,
      description: `${formatArtists(track.artists)} (upcoming)`,
    });
  }
  if (items.length === 0) {
    return [{ name: `${dim}(queue empty)${stale}`, description: 'Add tracks via search' }];
  }
  return items;
}
