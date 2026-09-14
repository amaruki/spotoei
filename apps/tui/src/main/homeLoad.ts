import type { CatalogTrackT, TimeRangeT } from 'spotoei-protocol';
import type { EntityManager } from '../entities';
import type { HomeManager } from '../home';
import { initialHomeTabs } from '../home/tabs';
import { diagnostic, homeFailure, reportFailure } from '../diagnostics';
import type { Ui } from '../ui/types';
import type { HomeRow } from '../ui/views/homeRows';
import { discover } from './homeDiscover';
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

export function ensureHomeTab(deps: HomeLoaderDeps, tab: string, force = false): Promise<void> {
  const { state, getUi } = deps;
  const ui = getUi();
  if (!ui || (tab !== 'for_you' && tab !== 'recently_played')) return Promise.resolve();
  const curRoute = ui.getRoute?.();
  if (curRoute && curRoute.kind === 'onboarding') return Promise.resolve();
  if (state.currentInfo && state.currentInfo.auth?.state === 'unauthenticated')
    return Promise.resolve();
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
