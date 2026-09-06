import { BoxRenderable, type CliRenderer, SelectRenderable } from '@opentui/core';
import { COLOR_BORDER, COLOR_BORDER_FOCUS, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';

export interface PanelNodes {
  box: BoxRenderable;
  list: SelectRenderable;
}

// Bordered panel with a title and a single select list, shared by the
// Home and Search 2x2 category grids.
export function makeListPanel(
  renderer: CliRenderer,
  id: string,
  title: string,
  emptyOptions: Array<{ name: string; description: string }>,
): PanelNodes {
  const box = new BoxRenderable(renderer, {
    id,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    focusedBorderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: ` ${title} `,
    titleColor: COLOR_TEXT,
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
  });
  const list = new SelectRenderable(renderer, {
    id: `${id}-list`,
    options: emptyOptions,
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    flexGrow: 1,
  });
  box.add(list);
  return { box, list };
}

export function makeGridColumn(renderer: CliRenderer, id: string): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'column',
  });
}
