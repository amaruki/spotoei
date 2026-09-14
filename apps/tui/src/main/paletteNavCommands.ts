import type { ArtistReleaseGroupT, HomeTabT, TimeRangeT } from 'spotoei-protocol';
import type { SearchFilter } from '../ui/views/search';
import { routeKind } from '../ui/core/navigationStack';
import { setHomeRange } from '../home/tabs';
import type { Ui } from '../ui/types';
import { switchArtistGroup } from './entityLoaders';
import { ensureHomeTab } from './homeLoad';
import type { PaletteActionDeps, PaletteCommand } from './paletteTypes';
import type { AppContext } from './types';

export function buildPaletteNavCommands(
  ctx: AppContext,
  actions: PaletteActionDeps,
  getUi: () => Ui | null,
): PaletteCommand[] {
  return [
    { name: 'Home View', description: 'Esc', action: () => getUi()?.setRoute('home') },
    { name: 'Browse', description: 'b', action: () => getUi()?.setRoute('browse') },
    { name: 'Search', description: '/', action: () => getUi()?.setRoute('search') },
    { name: 'Library', description: 'r', action: () => getUi()?.setRoute('library') },
    {
      name: 'Library: Tracks',
      description: 'saved tracks',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'saved_tracks' }),
    },
    {
      name: 'Library: Albums',
      description: 'saved albums',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'saved_albums' }),
    },
    {
      name: 'Library: Artists',
      description: 'followed artists',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'followed_artists' }),
    },
    {
      name: 'Library: Playlists',
      description: 'saved playlists',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'playlists' }),
    },
    { name: 'Queue', description: 'u', action: () => getUi()?.setRoute('queue') },
    {
      name: 'Toggle Sidebar',
      description: 'collapse at medium widths',
      action: () => {
        const u = getUi();
        if (u) u.toggleSidebar();
      },
    },
    ...(['all', 'track', 'artist', 'album', 'playlist'] as SearchFilter[]).map((filter) => ({
      name: `Search filter: ${filter}`,
      description: 'result type filter',
      action: () => getUi()?.setSearchFilter(filter),
    })),
    ...(['for_you', 'recently_played'] as HomeTabT[]).map((tab) => ({
      name: `Home tab: ${tab}`,
      description: 'home tab',
      action: () => getUi()?.setRoute({ kind: 'home', tab }),
    })),
    ...(
      [
        ['4 weeks', 'short_term'],
        ['6 months', 'medium_term'],
        ['All time', 'long_term'],
      ] as Array<[string, TimeRangeT]>
    ).map(([label, range]) => ({
      name: `Home range: ${label}`,
      description: 'for you range',
      action: () => {
        ctx.state.homeTabs = setHomeRange(ctx.state.homeTabs, range);
        const u = getUi();
        const r = u?.getRoute();
        if (u && r?.kind === 'home' && r.tab === 'for_you') {
          void ensureHomeTab(
            {
              homeManager: ctx.clients.homeManager,
              entityManager: ctx.clients.entityManager,
              getUi,
              state: ctx.state,
            },
            'for_you',
            true,
          );
        } else {
          u?.setRoute({ kind: 'home', tab: 'for_you' });
        }
      },
    })),
    {
      name: 'Reload Home',
      description: 'refresh active home tab',
      action: () => {
        const u = getUi();
        const r = u?.getRoute();
        if (u && r?.kind === 'home') {
          void ensureHomeTab(
            {
              homeManager: ctx.clients.homeManager,
              entityManager: ctx.clients.entityManager,
              getUi,
              state: ctx.state,
            },
            r.tab,
            true,
          );
        }
      },
    },
    ...(['album', 'single', 'appears_on', 'compilation'] as ArtistReleaseGroupT[]).map((group) => ({
      name: `Artist releases: ${group}`,
      description: 'release group tab',
      action: () => {
        const u = getUi();
        const r = u?.getRoute();
        if (r?.kind === 'artist') {
          void switchArtistGroup(
            { entityManager: ctx.clients.entityManager, getUi, state: ctx.state },
            r.id,
            group,
          );
        } else {
          u?.setStatus('Open an artist page first, then switch release groups');
        }
      },
    })),
    {
      name: 'Toggle Lyrics View',
      description: 'l',
      action: () => {
        const u = getUi();
        if (u) {
          const curRoute = u.getRoute();
          if (routeKind(curRoute) === 'lyrics') {
            u.setRoute(ctx.state.lastRouteBeforeLyrics);
          } else {
            ctx.state.lastRouteBeforeLyrics = curRoute;
            u.setRoute('lyrics');
            void actions.loadCurrentLyrics();
          }
        }
      },
    },
    { name: 'Settings', description: 's', action: () => getUi()?.setRoute('settings') },
  ];
}
