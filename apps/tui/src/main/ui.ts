import type { CatalogTrackT, SearchResponseT } from 'spotoei-protocol';

import { createUi } from '../ui';
import type { Ui } from '../ui/types';
import { ensureHomeTab } from './homeLoad';
import type { AppContext } from './types';
import type { UiInitActions } from './uiActions';
import { createBrowseSelectHandler } from './uiBrowseCallbacks';
import { createCycleVisualizerMode, installPaletteCommands } from './uiPaletteSetup';
import { createRouteChangeHandler } from './uiRouteCallbacks';
import { createSelectCallbacks } from './uiSelectCallbacks';

export async function initUi(
  ctx: AppContext,
  actions: UiInitActions,
  makeUi: typeof createUi = createUi,
): Promise<Ui> {
  const { clients, state, getUi, quit } = ctx;
  const play = (t: CatalogTrackT) => {
    if (t.uri.startsWith('spotify:album:')) {
      void actions.playTrackOrContext({ contextUri: t.uri, title: t.name });
    } else {
      // A direct play establishes its own queue context so Next continues
      // from here (plus radio) instead of a stale pool head.
      state.activePlaylistTracks = [t];
      void actions.playTrackOrContext({
        trackUri: t.uri,
        title: t.name,
        meta: {
          durationMs: t.durationMs,
          artists: t.artists?.map((a) => a.name) ?? [],
          album: t.albumName,
        },
      });
    }
    void actions.updateQueueView();
    void actions.ensureAutoplayTracks();
  };
  function submitSearch(query: string, label?: string): void {
    const q = query.trim();
    if (!q) return;
    const currentUi = getUi();
    if (currentUi) {
      const ck = `search:v1:${q.toLowerCase().replace(/\s+/g, ' ')}:track,album,artist,playlist`;
      if (
        !clients.cache.tryGetCached<SearchResponseT>(
          (state.currentInfo.auth as { accountId?: string } | undefined)?.accountId ?? 'anonymous',
          ck,
        )
      )
        currentUi.setSearchLoading(true);
      currentUi.setStatus(label ?? `Searching Spotify for "${q}"…`);
    }
    const seq = ++state.searchSequence;
    clients.searchClient
      .search(q)
      .then((res) => {
        if (seq === state.searchSequence) {
          const u = getUi();
          if (u) {
            u.setSearchLoading(false);
            u.setSearchResults(q, res);
            state.currentSearchHits = res.hits;
            const count = res.hits.length;
            u.setStatus(
              count > 0
                ? `Found ${count} result${count === 1 ? '' : 's'} for "${q}". Press Enter to play.`
                : `No results found for "${q}".`,
            );
          }
        }
      })
      .catch((e: unknown) => {
        if (seq === state.searchSequence) {
          const u = getUi();
          if (u) {
            u.setSearchLoading(false);
            const msg = e instanceof Error ? e.message : String(e);
            u.setStatus(`Search error: ${msg}`, true);
            u.setSearchResults(q, {
              query: q,
              hits: [],
              error: { code: 'SEARCH_ERROR', message: msg },
            });
          }
        }
      });
  }

  const cycleVisualizerMode = createCycleVisualizerMode(ctx);
  const ui = await makeUi(state.currentInfo, {
    onKey: actions.handleKey,
    onAuthenticate: actions.triggerAuth,
    onLogout: actions.triggerLogout,
    onSearchSubmit: (q) => submitSearch(q),
    ...createBrowseSelectHandler(ctx, play),
    ...createSelectCallbacks(ctx, actions, play),
    ...createRouteChangeHandler(ctx, actions),
    onSaveClientId: actions.handleSaveClientId,
    onCycleVisualizerMode: cycleVisualizerMode,
  });

  installPaletteCommands(ctx, actions, cycleVisualizerMode, getUi, quit, ui);

  // The initial route callback runs before ctx.getUi exists.
  if (state.currentInfo.auth.state === 'authenticated') {
    void ensureHomeTab(
      {
        homeManager: clients.homeManager,
        entityManager: clients.entityManager,
        getUi: () => ui,
        state,
      },
      state.homeTabs.activeTab,
    );
  }
  return ui;
}
