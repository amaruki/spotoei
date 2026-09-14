import type { CatalogTrackT } from 'spotoei-protocol';
import {
  activateBrowseEntry,
  browseEntriesKey,
  getBrowseTrack,
  getDynamicEntry,
  isBrowseTracksMode,
  resolveBrowseSelection,
} from './browseLoad';
import type { AppContext } from './types';

export function createBrowseSelectHandler(
  ctx: AppContext,
  play: (track: CatalogTrackT) => void,
): { onSelectBrowseEntry: (idx: number) => Promise<void> } {
  const { getUi } = ctx;
  const onSelectBrowseEntry = async (idx: number): Promise<void> => {
    const u = getUi();
    const r = u?.getRoute();
    if (!r || r.kind !== 'browse') return;
    if (isBrowseTracksMode()) {
      const t = getBrowseTrack(idx);
      if (t) play(t);
      return;
    }
    const path = r.path ?? {};
    // Live (dynamic) rows first: they are absent from the static
    // registry, so static resolution would misfire on them.
    const dynamic = getDynamicEntry(browseEntriesKey(path), idx);
    if (dynamic) {
      const nav = activateBrowseEntry(dynamic);
      if (nav.kind === 'message') {
        u?.setStatus(nav.text, nav.persist);
        return;
      }
      u?.setRoute(nav.route);
      if (nav.note) u?.setStatus(nav.note);
      return;
    }
    // Entry inline tracks vs browse sub-route; search never produced here.
    if (!path.category) {
      const nav = resolveBrowseSelection(path, idx);
      if (nav.kind === 'message') {
        u?.setStatus(nav.text, nav.persist);
        return;
      }
      u?.setRoute(nav.route);
      if (nav.note) u?.setStatus(nav.note);
      return;
    }
    const nav = resolveBrowseSelection(path, idx);
    if (nav.kind === 'message') {
      u?.setStatus(nav.text, nav.persist);
      return;
    }
    u?.setRoute(nav.route);
    if (nav.note) u?.setStatus(nav.note);
  };
  return { onSelectBrowseEntry };
}
