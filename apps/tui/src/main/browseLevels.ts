// @ts-nocheck
import type { BrowseEntryT } from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { getBrowseConfig } from '../config';
import type { Ui } from '../ui/types';
// @ts-ignore
import { getCategoryPlaylistsCached, getLiveCategories } from './browseLive';
import {
  browseEntriesKey,
  getLiveNavSeq,
  nextLiveNavSeq,
  resetBrowseLevel,
  setDisplayedCategories,
  setDynamicEntries,
  setLiveFallbackBanner,
  wasBrowseLiveFallback,
} from './browseLoadState';

export function ensureBrowseLevel(ui: Ui, path: { category?: string; entry?: string }): void {
  resetBrowseLevel();
  const categories = buildBrowseCategories(getBrowseConfig());
  if (!path.category) {
    setDisplayedCategories(categories.map((c) => ({ id: c.id, label: c.label })));
    ui.setBrowseCategories(categories);
    if (wasBrowseLiveFallback())
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(
        'Browse live unavailable · using offline categories',
      );
    else
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
    return;
  }
  const cat = categories.find((c) => c.id === path.category);
  if (!cat) {
    ui.setStatus(`Unknown browse category: ${path.category}`, true);
    return;
  }
  ui.setBrowseEntries(cat.entries);
}
export async function ensureBrowseLevelLive(
  ui: Ui,
  path: { category?: string; entry?: string },
  api: unknown,
  cache?: unknown,
  accountId = 'default',
  signal?: AbortSignal,
): Promise<boolean> {
  const seq = nextLiveNavSeq();
  const stale = () => seq !== getLiveNavSeq() || signal?.aborted;
  resetBrowseLevel();
  if (!path.category) {
    // Transient marker while live data resolves (spotify-player renders
    // "Loading..." the same way); replaced by content or fallback banner.
    ui.setStatus('Loading browse…');
    try {
      const { categories, fallback, banner, code } = await getLiveCategories(
        api,
        cache,
        accountId,
        signal,
      );
      setLiveFallbackBanner(fallback);
      if (stale()) return false;
      if (!fallback && categories.length > 0) {
        const mapped = categories.map((c) => ({
          id: c.id,
          label: c.name,
          entries: [] as BrowseEntryT[],
        }));
        setDisplayedCategories(mapped.map((c) => ({ id: c.id, label: c.label })));
        ui.setBrowseCategories(mapped);
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
        return true;
      }
      const cats = buildBrowseCategories(getBrowseConfig());
      setDisplayedCategories(cats.map((c) => ({ id: c.id, label: c.label })));
      ui.setBrowseCategories(cats);
      if (fallback && !stale()) {
        const msg =
          code === 'QUOTA_EXCEEDED' && banner
            ? banner
            : 'Browse live unavailable · using offline categories';
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(msg);
      } else {
        (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
      }
      return true;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      if (err instanceof Error && err.name === 'AbortError') return false;
      const cats = buildBrowseCategories(getBrowseConfig());
      setDisplayedCategories(cats.map((c) => ({ id: c.id, label: c.label })));
      ui.setBrowseCategories(cats);
      return true;
    }
  }
  const id = path.category;
  const key = browseEntriesKey(path);
  // Static registry ids render instantly: the live endpoint has no such
  // categories, so probing it first only burns a doomed request (the
  // 403s for discover/moods/charts/... seen in production logs).
  const staticCat = buildBrowseCategories(getBrowseConfig()).find((c) => c.id === id);
  if (staticCat) {
    if (stale()) return false;
    ui.setBrowseEntries(staticCat.entries);
    return true;
  }
  // Live Spotify category id: probe its playlists, else an honest message.
  let isStale = false;
  ui.setStatus('Loading browse…');
  try {
    // Try to detect stale via cache peek
    if (cache) {
      const cacheKey = `browse:category:${encodeURIComponent(id)}:playlists:0`;
      const peek = cache.tryGetCached<unknown[]>(accountId, cacheKey);
      if (peek?.isStale) isStale = true;
    }
    const playlists = await getCategoryPlaylistsCached(api, cache, accountId, id, signal);
    if (stale()) return false;
    if (playlists.length > 0) {
      const entries = playlists.map((p) => ({
        id: p.id,
        label: p.name,
        description: p.description ?? '',
        enabled: true,
        source: { kind: 'playlist', playlistUri: p.uri } as unknown as BrowseEntryT['source'],
      }));
      setDynamicEntries(key, entries);
      ui.setBrowseEntries(entries, { isStale } as unknown as never);
      (ui as unknown as { setBrowseBanner?: (s: string | null) => void }).setBrowseBanner?.(null);
      return true;
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    if (err instanceof Error && err.name === 'AbortError') return false;
  }
  if (stale()) return false;
  ui.setStatus(`Unknown browse category: ${id}`, true);
  return false;
}
