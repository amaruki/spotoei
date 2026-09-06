import { BoxRenderable, type CliRenderer, SelectRenderable } from '@opentui/core';
import { COLOR_BORDER, COLOR_BORDER_FOCUS, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import { getNavOptions } from '../views/nav';
import type { UiViewState } from '../types';

export interface SidebarNodes {
  sidebar: BoxRenderable;
  nav: SelectRenderable;
}

export function buildSidebar(renderer: CliRenderer, state: UiViewState): SidebarNodes {
  const sidebar = new BoxRenderable(renderer, {
    id: 'sidebar',
    width: 24,
    height: '100%',
    flexShrink: 0,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ' ♫ Spotoei ',
    titleColor: COLOR_BORDER_FOCUS,
    bottomTitle: ' [Tab] Focus ',
    bottomTitleAlignment: 'center',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    focusable: true,
  });
  const nav = new SelectRenderable(renderer, {
    id: 'nav',
    options: getNavOptions(state.auth.state === 'authenticated', Boolean(state.isPrivateSession)),
    showScrollIndicator: false,
    showDescription: true,
    itemSpacing: 0,
    width: '100%',
    height: '100%',
    flexGrow: 1,
  });
  sidebar.add(nav);
  return { sidebar, nav };
}
