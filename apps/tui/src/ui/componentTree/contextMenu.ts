import {
  BoxRenderable,
  type CliRenderer,
  SelectRenderable,
  TextRenderable,
  fg,
  t,
} from '@opentui/core';
import { COLOR_BORDER_FOCUS, COLOR_DIM, COLOR_PANEL_BG } from '../theme';

export interface ContextMenuNodes {
  menu: BoxRenderable;
  menuTitle: TextRenderable;
  menuList: SelectRenderable;
}

export function buildContextMenu(renderer: CliRenderer): ContextMenuNodes {
  const menu = new BoxRenderable(renderer, {
    id: 'context-menu',
    position: 'absolute',
    top: 6,
    left: 10,
    width: 44,
    borderStyle: 'single',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Actions',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
    zIndex: 90,
  });
  const menuTitle = new TextRenderable(renderer, {
    id: 'context-menu-title',
    content: t`${fg(COLOR_DIM)('Actions')}`,
  });
  const menuList = new SelectRenderable(renderer, {
    id: 'context-menu-list',
    options: [],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: 8,
  });
  const menuHint = new TextRenderable(renderer, {
    id: 'context-menu-hint',
    content: t`${fg(COLOR_DIM)('↑/↓ select • Enter run • Esc close')}`,
  });
  menu.add(menuTitle);
  menu.add(menuList);
  menu.add(menuHint);
  return { menu, menuTitle, menuList };
}
