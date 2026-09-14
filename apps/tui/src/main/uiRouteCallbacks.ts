import { routeKind } from '../ui/core/navigationStack';
import type { Route } from '../ui/types';
import { ensureBrowseEntry, ensureBrowseLevelLive } from './browseLoad';
import { ensureEntityRoute } from './entityLoaders';
import { ensureHomeTab } from './homeLoad';
import type { AppContext } from './types';
import type { UiInitActions } from './uiActions';

export function createRouteChangeHandler(
  ctx: AppContext,
  actions: UiInitActions,
): { onRouteChange: (route: Route) => void } {
  const { clients, state, getUi } = ctx;
  const onRouteChange = (route: Route): void => {
    const curKind = routeKind(route);
    if (curKind === 'home' && route.kind === 'home') {
      state.homeTabs.activeTab = route.tab;
      if (state.currentInfo.auth.state === 'authenticated') {
        void ensureHomeTab(
          {
            homeManager: clients.homeManager,
            entityManager: clients.entityManager,
            getUi,
            state,
          },
          route.tab,
        );
      }
    }
    if (curKind === 'library') {
      const section = route.kind === 'library' ? route.section : state.librarySection;
      if (state.libraryItems.length === 0 || state.librarySection !== section) {
        state.librarySection = section;
        state.libraryItems = [];
        void actions.loadLibrary(false, section);
      }
    }
    if (curKind === 'queue') {
      void actions.updateQueueView();
      void actions.ensureAutoplayTracks();
    }
    if (curKind === 'lyrics') {
      void actions.loadCurrentLyrics();
    }
    if (curKind === 'settings') {
      void clients.playback
        .getAudioConfig()
        .then((cfg) => {
          state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
          getUi()?.setAudioConfig(cfg);
        })
        .catch(() => {});
    }
    if (curKind === 'artist' || curKind === 'album' || curKind === 'playlist') {
      void ensureEntityRoute({ entityManager: clients.entityManager, getUi, state }, route);
    }
    if (curKind === 'browse' && route.kind === 'browse') {
      const u = getUi();
      if (!u) return;
      const path = route.path ?? {};
      if (path.entry) {
        void ensureBrowseEntry(u, path, {
          entityManager: clients.entityManager,
          searchClient: clients.searchClient,
        });
      } else {
        // Live Spotify categories first, offline registry on restriction.
        const accountId =
          (state.currentInfo.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous';
        void ensureBrowseLevelLive(u, path, clients.webApi, clients.cache, accountId);
      }
    }
  };
  return { onRouteChange };
}
