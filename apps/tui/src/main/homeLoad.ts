import type { CatalogArtistT, CatalogTrackT, TimeRangeT } from 'spotoei-protocol';
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

// Discover preview: real playable tracks, fetched immediately alongside
// the other panels. New releases resolve to album tracks (never albums
// masquerading as tracks); recommendations fill gaps; the already-loaded
// Top Tracks are the offline last resort so the panel is never empty
// when data exists elsewhere.
async function loadDiscoverPreview(
  entityManager: EntityManager,
  seedTracks: CatalogTrackT[],
): Promise<CatalogTrackT[]> {
  try {
    const albums = await entityManager.loadNewReleases(6);
    const perAlbum = await Promise.all(
      albums.slice(0, 4).map((a) =>
        entityManager.loadAlbumTracks(a.id, 0, 2).catch(() => null),
      ),
    );
    const tracks = perAlbum.flatMap((p) => p?.items ?? []).slice(0, 6);
    if (tracks.length > 0) return tracks;
  } catch {
    // Fall through to recommendations
  }
  try {
    const recs = await entityManager.loadRecommendations({
      limit: 8,
      seedTracks: seedTracks
        .map((t) => t.id)
        .filter((id) => !id.startsWith('sk'))
        .slice(0, 5),
    });
    if (recs.length > 0) return recs.slice(0, 6);
  } catch {
    // Fall through to seed fallback
  }
  return seedTracks.slice(0, 6);
}

// Non-selectable loading markers. Skeletons are headers only — never fake
// tracks/artists — so Enter can never play a `Loading…` row.
function loadingRows(): HomeRow[] {
  return [
    { kind: 'header', text: 'Loading…' },
    { kind: 'header', text: 'Loading…' },
    { kind: 'header', text: 'Loading…' },
    { kind: 'header', text: 'Loading…' },
  ];
}

// Load the active Home tab. All four panels fetch immediately in parallel
// and compose per-section: one scope failure degrades its own panel with
// a reauthorization hint while the other panels still paint. Failures
// never block playback and never wipe the whole page.
export async function ensureHomeTab(
  deps: HomeLoaderDeps,
  tab: string,
  force = false,
): Promise<void> {
  const { homeManager, entityManager, getUi, state } = deps;
  const ui = getUi();
  if (!ui) return;
  const tabs = tabsOf(state);
  if (tab !== 'for_you' && tab !== 'recently_played') return;

  ui.setHomeItems(loadingRows(), { rangeLabel: RANGE_LABEL[tabs.range] });
  ui.setStatus(tab === 'for_you' ? 'Loading For You…' : 'Loading Recently Played…');

  const [forYou, recent] = await Promise.all([
    homeManager.loadForYou(tabs.range, force).then(
      (d) => ({ ok: true as const, data: d }),
      (err: unknown) => ({ ok: false as const, error: err }),
    ),
    homeManager.loadRecentlyPlayed(force).then(
      (d) => ({ ok: true as const, data: d }),
      (err: unknown) => ({ ok: false as const, error: err }),
    ),
  ]);

  if (tab === 'for_you') {
    state.homeTabs = setForYouError(
      tabs,
      forYou.ok ? undefined : forYou.error instanceof Error ? forYou.error.message : String(forYou.error),
    );
  } else {
    state.homeTabs = setRecentError(
      tabs,
      recent.ok ? undefined : recent.error instanceof Error ? recent.error.message : String(recent.error),
    );
  }

  const topTracks: CatalogTrackT[] = forYou.ok ? (forYou.data.topTracks as CatalogTrackT[]) : [];
  const topArtists: CatalogTrackT[] | CatalogArtistT[] = forYou.ok
    ? (forYou.data.topArtists as CatalogArtistT[])
    : [];

  // Saved-state for visible recent tracks (at most 40 URIs); a
  // membership failure degrades to unmarked rows, never an error.
  const saved = new Set<string>();
  if (recent.ok && recent.data.items.length > 0) {
    const uris = recent.data.items
      .map((i) => (i.track as CatalogTrackT).uri)
      .filter((u): u is string => typeof u === 'string')
      .slice(0, 40);
    try {
      for (const m of await entityManager.checkMembership(uris)) {
        if (m.state === 'saved') saved.add(m.uri);
      }
    } catch {
      // Degrade gracefully
    }
  }

  const recentItems = recent.ok ? recent.data.items : [];
  const recentSeed: CatalogTrackT[] =
    recentItems.length > 0
      ? recentItems.slice(0, 6).map((i) => i.track as CatalogTrackT)
      : topTracks.slice(0, 6);
  const preview = await loadDiscoverPreview(entityManager, recentSeed.length > 0 ? recentSeed : topTracks);

  const rows: HomeRow[] = [];
  const rangeSuffix = forYou.ok ? (RANGE_LABEL[forYou.data.range] ?? forYou.data.range) : RANGE_LABEL[tabs.range];
  if (topTracks.length > 0) {
    rows.push({ kind: 'header', text: `Top Tracks · ${rangeSuffix}` });
    rows.push(...topTracks.slice(0, 8).map((t): HomeRow => ({ kind: 'track', track: t })));
  } else if (!forYou.ok) {
    const msg = forYou.error instanceof Error ? forYou.error.message : String(forYou.error);
    rows.push({ kind: 'header', text: `Top Tracks unavailable (${msg}) — press A to reauthorize` });
  }
  if ((topArtists as CatalogArtistT[]).length > 0) {
    rows.push({ kind: 'header', text: 'Top Artists' });
    rows.push(
      ...(topArtists as CatalogArtistT[])
        .slice(0, 6)
        .map((a): HomeRow => ({ kind: 'artist', artist: a })),
    );
  }
  if (recentItems.length > 0) {
    rows.push({ kind: 'header', text: 'Recently Played' });
    rows.push(
      ...recentItems.slice(0, 6).map((i): HomeRow => {
        const t = i.track as CatalogTrackT;
        return {
          kind: 'track',
          track: t,
          playedAt: i.playedAt,
          saved: typeof t.uri === 'string' && saved.has(t.uri),
        };
      }),
    );
  } else if (!recent.ok) {
    const msg = recent.error instanceof Error ? recent.error.message : String(recent.error);
    rows.push({ kind: 'header', text: `Recently Played unavailable (${msg}) — press A to reauthorize` });
  } else if (topTracks.length > 0) {
    rows.push({ kind: 'header', text: 'Recently Played' });
    rows.push(...topTracks.slice(0, 6).map((t): HomeRow => ({ kind: 'track', track: t })));
  }
  if (preview.length > 0) {
    rows.push({ kind: 'header', text: 'Discover · New & Recommended' });
    rows.push(...preview.map((t): HomeRow => ({ kind: 'track', track: t })));
  }

  ui.setHomeItems(rows, { rangeLabel: rangeSuffix });
}
