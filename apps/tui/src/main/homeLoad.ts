import type { CatalogAlbumT, CatalogTrackT, TimeRangeT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import type { HomeManager } from '../home';
import { initialHomeTabs } from '../home/tabs';
import { diagnostic, homeFailure, reportFailure } from '../diagnostics';
import type { Ui } from '../ui/types';
import type { HomeRow } from '../ui/views/homeRows';
import type { AppState } from './types';

export interface HomeLoaderDeps {
  homeManager: HomeManager;
  entityManager: EntityManager;
  getUi: () => Ui | null;
  state: AppState;
}
const RANGE_LABEL: Record<TimeRangeT, string> = {
  short_term: '4 weeks',
  medium_term: '6 months',
  long_term: 'All time',
};
const loads = new WeakMap<AppState, { key: string; promise: Promise<void> }>();
export function cancelHomeLoad(state: AppState): void {
  loads.delete(state);
}

function isCatalogRestriction(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Quota exhaustion keeps its dedicated reporting path (quota banner),
  // never the silent restriction downgrade.
  if (/QUOTA/i.test(msg)) return false;
  return /FORBIDDEN/.test(msg) || /\b403\b/.test(msg) || /HTTP_404/.test(msg);
}

// Other tracks by the seed artists, via artist-albums → album-tracks.
// Uses only non-deprecated endpoints; seed IDs are excluded so the result
// never duplicates the Recently Played / Top Tracks panels.
async function moreFromSeedArtists(
  manager: EntityManager,
  seeds: CatalogTrackT[],
  count: number,
): Promise<CatalogTrackT[]> {
  const excluded = new Set(seeds.map((track) => track.id));
  const artistIds: string[] = [];
  const seenArtists = new Set<string>();
  for (const track of seeds) {
    for (const artist of track.artists ?? []) {
      const id = typeof artist === 'string' ? '' : artist?.id;
      if (!id || id === 'unknown' || seenArtists.has(id)) continue;
      seenArtists.add(id);
      artistIds.push(id);
      if (artistIds.length >= 3) break;
    }
    if (artistIds.length >= 3) break;
  }
  const out: CatalogTrackT[] = [];
  const seenTracks = new Set<string>();
  for (const artistId of artistIds) {
    if (out.length >= count) break;
    let albums: CatalogAlbumT[] = [];
    try {
      albums = (await manager.loadArtistAlbums(artistId, 'album', 0, 10)).items;
    } catch {
      continue;
    }
    for (const album of albums.slice(0, 2)) {
      if (out.length >= count) break;
      let items: CatalogTrackT[] = [];
      try {
        items = (await manager.loadAlbumTracks(album.id, 0, 5)).items;
      } catch {
        continue;
      }
      for (const track of items) {
        if (excluded.has(track.id) || seenTracks.has(track.id)) continue;
        seenTracks.add(track.id);
        out.push(track);
        if (out.length >= count) break;
      }
    }
  }
  return out;
}

async function discover(
  manager: EntityManager,
  seeds: CatalogTrackT[],
): Promise<{ tracks: CatalogTrackT[]; label: string }> {
  try {
    const albums = await manager.loadNewReleases(6);
    const pages = await Promise.all(
      albums.slice(0, 4).map((album) => manager.loadAlbumTracks(album.id, 0, 2)),
    );
    const tracks = pages.flatMap((page) => page.items).slice(0, 6);
    if (tracks.length) return { tracks, label: 'Discover · New releases' };
  } catch (error) {
    // Browse endpoints are restricted for dev apps without Extended Quota
    // (403/404) — expected, not actionable. Log at diagnostic level and fall
    // through to recommendations/history instead of error-reporting every
    // home load.
    if (isCatalogRestriction(error)) {
      diagnostic('application', 'home.discover.releases.unavailable', {});
    } else {
      reportFailure('application', 'home.discover.releases', error);
    }
  }
  if (seeds.length) {
    const seedArtistIds = [
      ...new Set(
        seeds.flatMap((track) =>
          (track.artists ?? [])
            .map((artist) => (typeof artist === 'string' ? '' : artist?.id))
            .filter((id): id is string => !!id && id !== 'unknown'),
        ),
      ),
    ].slice(0, 5);
    try {
      const tracks = await manager.loadRecommendations({
        limit: 8,
        seedTracks: seeds.slice(0, 5).map((track) => track.id),
        seedArtists: seedArtistIds,
      });
      if (tracks.length) return { tracks: tracks.slice(0, 6), label: 'Discover · Recommended' };
    } catch (error) {
      if (isCatalogRestriction(error)) {
        diagnostic('application', 'home.discover.recommendations.unavailable', {});
      } else {
        reportFailure('application', 'home.discover.recommendations', error);
      }
    }
    // Both Spotify discovery endpoints are restricted for dev apps, so build
    // Discover from working endpoints: other tracks by the seed artists.
    // Seed track IDs are excluded so this never mirrors Recently Played.
    try {
      const tracks = await moreFromSeedArtists(manager, seeds, 6);
      if (tracks.length) return { tracks, label: 'Discover · More from your artists' };
    } catch (error) {
      if (isCatalogRestriction(error)) {
        diagnostic('application', 'home.discover.artists.unavailable', {});
      } else {
        reportFailure('application', 'home.discover.artists', error);
      }
    }
  }
  return {
    tracks: seeds.slice(0, 6),
    label: seeds.length
      ? 'Discover · From your listening history'
      : 'Discover · No preview available',
  };
}

export function ensureHomeTab(deps: HomeLoaderDeps, tab: string, force = false): Promise<void> {
  const { state, getUi } = deps;
  const ui = getUi();
  if (!ui || (tab !== 'for_you' && tab !== 'recently_played')) return Promise.resolve();
  if (state.currentInfo && state.currentInfo.auth?.state !== 'authenticated') return Promise.resolve();
  state.homeTabs ??= initialHomeTabs();
  const range = state.homeTabs.range;
  const key = tab + ':' + range;
  const active = loads.get(state);
  if (!force && active?.key === key) return active.promise;
  const job = { key, promise: Promise.resolve() };
  loads.set(state, job);
  const current = () => {
    if (loads.get(state) !== job || getUi() !== ui || state.homeTabs.range !== range) return false;
    const route = ui.getRoute?.();
    return !route || (route.kind === 'home' && route.tab === tab);
  };
  job.promise = load(deps, ui, range, current, force)
    .catch((error: unknown) => {
      const id = reportFailure('ui', 'home.render', error);
      if (current()) ui.setStatus('Home display failed [' + id + ']', true);
    })
    .finally(() => {
      if (loads.get(state) === job) loads.delete(state);
    });
  return job.promise;
}

async function load(
  deps: HomeLoaderDeps,
  ui: Ui,
  range: TimeRangeT,
  current: () => boolean,
  force: boolean,
): Promise<void> {
  const { homeManager, entityManager, state } = deps;
  const sections: Record<'top' | 'recent' | 'discover', HomeRow[]> = {
    top: [
      { kind: 'header', text: 'Top Tracks · Loading…' },
      { kind: 'header', text: 'Top Artists · Loading…' },
    ],
    recent: [{ kind: 'header', text: 'Recently Played · Loading…' }],
    discover: [{ kind: 'header', text: 'Discover · Loading…' }],
  };
  const paint = () => {
    if (current())
      ui.setHomeItems([...sections.top, ...sections.recent, ...sections.discover], {
        rangeLabel: RANGE_LABEL[range],
      });
  };
  paint();
  ui.setStatus('Loading Home…');
  diagnostic('application', 'home.load', { range });
  let topTracks: CatalogTrackT[] = [];
  let recentTracks: CatalogTrackT[] = [];
  const failureHints: string[] = [];
  const top = homeManager
    .loadForYou(range, force)
    .then(
      (data) => {
        topTracks = data.topTracks;
        sections.top = [
          {
            kind: 'header',
            text:
              'Top Tracks · ' +
              RANGE_LABEL[range] +
              (topTracks.length ? '' : ' · No listening data'),
          },
          ...topTracks.slice(0, 8).map((track): HomeRow => ({ kind: 'track', track })),
          {
            kind: 'header',
            text: 'Top Artists' + (data.topArtists.length ? '' : ' · No listening data'),
          },
          ...data.topArtists.slice(0, 6).map((artist): HomeRow => ({ kind: 'artist', artist })),
        ];
        if (current()) state.homeTabs = { ...state.homeTabs, forYouError: undefined };
      },
      (error: unknown) => {
        const message = homeFailure('top', error);
        failureHints.push(message);
        sections.top = [
          { kind: 'header', text: 'Top Tracks unavailable · ' + message },
          { kind: 'header', text: 'Top Artists unavailable · ' + message },
        ];
        if (current())
          state.homeTabs = {
            ...state.homeTabs,
            forYouError: error instanceof Error ? error.message : String(error),
          };
      },
    )
    .then(paint);
  const recent = homeManager
    .loadRecentlyPlayed(force)
    .then(
      async (data) => {
        recentTracks = data.items.map((item) => item.track);
        sections.recent = [
          {
            kind: 'header',
            text: 'Recently Played' + (data.items.length ? '' : ' · No listening history'),
          },
          ...data.items.slice(0, 6).map((item): HomeRow => ({
            kind: 'track',
            track: item.track,
            playedAt: item.playedAt,
          })),
        ];
        if (current()) state.homeTabs = { ...state.homeTabs, recentError: undefined };
        paint();
        if (!recentTracks.length) return;
        try {
          const membership = await entityManager.checkMembership(
            recentTracks.slice(0, 40).map((track) => track.uri),
          );
          const saved = new Set(
            membership.filter((item) => item.state === 'saved').map((item) => item.uri),
          );
          sections.recent = sections.recent.map((row) =>
            row.kind === 'track' ? { ...row, saved: saved.has(row.track.uri) } : row,
          );
        } catch (error) {
          reportFailure('application', 'home.membership', error);
        }
      },
      (error: unknown) => {
        const message = homeFailure('recent', error);
        failureHints.push(message);
        sections.recent = [{ kind: 'header', text: 'Recently Played unavailable · ' + message }];
        if (current())
          state.homeTabs = {
            ...state.homeTabs,
            recentError: error instanceof Error ? error.message : String(error),
          };
      },
    )
    .then(paint);
  await Promise.all([top, recent]);
  if (!current()) return;
  const preview = await discover(entityManager, recentTracks.length ? recentTracks : topTracks);
  sections.discover = [
    { kind: 'header', text: preview.label },
    ...preview.tracks.map((track): HomeRow => ({ kind: 'track', track })),
  ];
  paint();
  if (current())
    ui.setStatus(
      failureHints.length ? 'Home: ' + failureHints[0] : 'Home loaded',
      failureHints.length > 0,
    );
}
