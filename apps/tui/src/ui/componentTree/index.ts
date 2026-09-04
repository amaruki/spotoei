import { BoxRenderable, TextRenderable, createCliRenderer } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { COLOR_BG } from '../theme';
import type { UiViewState } from '../types';
import { buildContextMenu, type ContextMenuNodes } from './contextMenu';
import { buildMain, type MainNodes } from './main';
import { buildPalette, type PaletteNodes } from './palette';
import { buildPlaybackBar, type PlaybackBarNodes } from './playbackBar';
import { buildSidebar, type SidebarNodes } from './sidebar';

// Flat handle the controller uses to look up every renderable by id.
// Mirrors the original `buildRoot` return shape so existing wiring does not
// need to know about the new region-based builders.
export interface BuiltUi
  extends SidebarNodes, MainNodes, PlaybackBarNodes, PaletteNodes, ContextMenuNodes {
  root: BoxRenderable;
  mainArea: BoxRenderable;
  headerText: TextRenderable;
}

export interface BuildArgs {
  renderer: CliRenderer;
  state: UiViewState;
}

export function buildRoot({ renderer, state }: BuildArgs): BuiltUi {
  const root = new BoxRenderable(renderer, {
    id: 'root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: COLOR_BG,
  });

  // Header removed from top per user request ("hilangkan top bar")
  const headerText = new TextRenderable(renderer, {
    id: 'header-text',
    content: '',
  });

  const mainArea = new BoxRenderable(renderer, {
    id: 'main-area',
    flexDirection: 'row',
    flexGrow: 1,
    backgroundColor: COLOR_BG,
  });
  root.add(mainArea);

  const sidebar = buildSidebar(renderer, state);
  mainArea.add(sidebar.sidebar);

  const main = buildMain(renderer, state);
  mainArea.add(main.center);
  mainArea.add(main.right);

  const playbackBar = buildPlaybackBar(renderer);
  root.add(playbackBar.playbackBar);

  const palette = buildPalette(renderer);
  root.add(palette.palette);

  const menu = buildContextMenu(renderer);
  root.add(menu.menu);

  return {
    root,
    mainArea,
    headerText,
    ...sidebar,
    ...main,
    ...playbackBar,
    ...palette,
    ...menu,
  };
}

// Public entry point used by the controller. Mirrors `createUi` from the
// original `ui.ts` so the `apps/tui/src/main.ts` call site is unchanged.
export async function createUi(initial: UiViewState, opts: UiOptions): Promise<Ui> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
  });
  return createUiCore(renderer, initial, opts);
}

// Re-exported here to keep `./ui/index` flat. The real implementations
// live in `../core` and `../types` to stay under the 300 LoC per-file cap.
import type { Ui, UiOptions } from '../types';
import { createUiCore } from '../core';
