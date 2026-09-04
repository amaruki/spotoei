import type { CatalogArtistT, CatalogTrackT, TimeRangeT } from 'spotoei-protocol';
import { buildBrowseCategories } from '../browse';
import { getBrowseConfig } from '../config';
import type { EntityManager } from '../entities';
import type { HomeManager } from '../home';
import { initialHomeTabs, setForYouError, setRecentError } from '../home/tabs';
import type { Ui } from '../ui/types';
import type { HomeRow } from '../ui/views/homeRows';
import type { AppState } from './types';

export interface HomeLoaderDeps {
  homeManager: HomeManager;
  entityManager: EntityManager;
  getUi: () => Ui | null;
  state: AppState;
}

function tabsOf(state: AppState) {
  if (!state.homeTabs) state.homeTabs = initialHomeTabs();
  return state.homeTabs;
}

const RANGE_LABEL: Record<TimeRangeT, string> = {
  short_term: '4 weeks',
  medium_term: '6 months',
  long_term: 'All time',
};

// Static Discover rows from the browse registry. No API involved, so the
// Discover panel always has content — even offline or on first paint.
export function discoverRows(): HomeRow[] {
  const rows: HomeRow[] = [];
  for (const category of buildBrowseCategories(getBrowseConfig())) {
    rows.push({
      kind: 'discover',
      id: category.id,
      label: category.label,
      description: `${category.entries.length} sections`,
    });
  }
  return rows;
}

// Load the active Home tab. Discover rows paint instantly so the page
// always has content; cached rows render instantly; scope errors stay
// tab-local with a reauthorization hint; failures never block playback.
export async function ensureHomeTab(
  deps: HomeLoaderDeps,
  tab: string,
  force = false,
): Promise<void> {
  const { homeManager, getUi, state } = deps;
  const ui = getUi();
  if (!ui) return;
  const tabs = tabsOf(state);
  if (tab === 'for_you') {
    ui.setHomeItems([...discoverRows()], { rangeLabel: RANGE_LABEL[tabs.range] });
    ui.setStatus('Loading For You…');
    try {
      const data = await homeManager.loadForYou(tabs.range, force);
      state.homeTabs = setForYouError(tabs, undefined);
      const rows: HomeRow[] = [
        { kind: 'header', text: `Top Tracks · ${RANGE_LABEL[data.range] ?? data.range}` },
        ...(data.topTracks as CatalogTrackT[]).map((t): HomeRow => ({ kind: 'track', track: t })),
        { kind: 'header', text: 'Top Artists' },
        ...(data.topArtists as CatalogArtistT[]).map((a): HomeRow => ({
          kind: 'artist',
          artist: a,
        })),
        ...discoverRows(),
      ];
      ui.setHomeItems(rows, { rangeLabel: RANGE_LABEL[data.range] ?? data.range });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.homeTabs = setForYouError(tabs, msg);
      ui.setHomeItems([], { error: `For You unavailable (${msg}) — press A to reauthorize` });
    }
    return;
  }
  if (tab === 'recently_played') {
    ui.setHomeItems([...discoverRows()]);
    ui.setStatus('Loading Recently Played…');
    try {
      const data = await homeManager.loadRecentlyPlayed(force);
      state.homeTabs = setRecentError(tabs, undefined);
      // Batch saved-state for visible tracks (at most 40 URIs); a
      // membership failure degrades to unmarked rows, never an error.
      const uris = data.items
        .map((i) => (i.track as CatalogTrackT).uri)
        .filter((u): u is string => typeof u === 'string')
        .slice(0, 40);
      const saved = new Set<string>();
      try {
        for (const m of await deps.entityManager.checkMembership(uris)) {
          if (m.state === 'saved') saved.add(m.uri);
        }
      } catch {
        // Degrade gracefully
      }
      const rows: HomeRow[] = [
        { kind: 'header', text: 'Recently Played' },
        ...data.items.map((i): HomeRow => {
          const t = i.track as CatalogTrackT;
          return {
            kind: 'track',
            track: t,
            playedAt: i.playedAt,
            saved: typeof t.uri === 'string' && saved.has(t.uri),
          };
        }),
        ...discoverRows(),
      ];
      ui.setHomeItems(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.homeTabs = setRecentError(tabs, msg);
      ui.setHomeItems([], {
        error: `Recently Played unavailable (${msg}) — press A to reauthorize`,
      });
    }
  }
}
