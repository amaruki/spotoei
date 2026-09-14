import { panelPositionKey } from '../../navigation/viewPositions';
import {
  focusedHomeList,
  focusedSearchList,
  HOME_PANELS,
  homePanelLists,
  SEARCH_PANELS,
  searchPanelLists,
} from './categoryPanels';
import { routeKind } from './navigationStack';
import type { AnySelect, Route, UiCoreContext } from './types';

// Route→list lookup and per-panel position saving, extracted from
// `navigation.ts` for the 300 LoC cap.
export function listForRoute(ctx: UiCoreContext, r: Route): AnySelect | null {
  const kind = routeKind(r);
  if (kind === 'home') return focusedHomeList(ctx);
  if (kind === 'browse') return ctx.built.browseList;
  if (kind === 'search') return focusedSearchList(ctx);
  if (kind === 'library') return ctx.built.libraryList;
  if (kind === 'queue') return ctx.built.queueList;
  if (kind === 'artist') return ctx.built.artistList;
  if (kind === 'album') return ctx.built.albumList;
  if (kind === 'playlist') return ctx.built.playlistList;
  return null;
}

export function saveRoutePosition(ctx: UiCoreContext, r: Route): void {
  const { built } = ctx;
  const kind = routeKind(r);
  if (kind === 'home') {
    homePanelLists(built).forEach((l, i) =>
      ctx.positions.saveKey(panelPositionKey(r, 'home', HOME_PANELS[i] ?? String(i)), {
        selected: l.getSelectedIndex(),
        scroll: 0,
      }),
    );
    return;
  }
  if (kind === 'search') {
    searchPanelLists(built).forEach((l, i) =>
      ctx.positions.saveKey(panelPositionKey(r, 'search', SEARCH_PANELS[i] ?? String(i)), {
        selected: l.getSelectedIndex(),
        scroll: 0,
      }),
    );
    return;
  }
  const list = listForRoute(ctx, r);
  if (list) {
    ctx.positions.save(r, { selected: list.getSelectedIndex(), scroll: 0 });
  }
}
