// @ts-nocheck
import { createAuthSetters } from './apiAuth';
import { createBrowseSetters } from './apiBrowse';
import { createContentSetters } from './apiContent';
import { createLibrarySetters } from './apiLibrary';
import { createMiscSetters } from './apiMisc';
import { createNavigationSetters } from './apiNavigation';
import { createPaletteSetters } from './apiPalette';
import { createPlaybackSetters } from './apiPlayback';
import { createEntitySetters } from './entitySetters';
import { createPanelSetters } from './panelSetters';
import type { Ui, UiCoreContext } from './types';

// Creates the public `Ui` API handle that consumers use to update state.
// All setters propagate through `ctx.helpers` and trigger granular repaints.
// Setter groups live in `api*.ts` sibling modules; the spread order below
// preserves the original object key order.
export function createUiApi(ctx: UiCoreContext): Ui {
  return {
    ...createNavigationSetters(ctx),
    ...createLibrarySetters(ctx),
    ...createPanelSetters(ctx),
    ...createEntitySetters(ctx),
    ...createBrowseSetters(ctx),
    ...createContentSetters(ctx),
    ...createPaletteSetters(ctx),
    ...createPlaybackSetters(ctx),
    ...createAuthSetters(ctx),
    ...createMiscSetters(ctx),
  };
}
