import { blurAllPanels } from './categoryPanels';
import type { UiCoreContext } from './types';
// Command palette state / fuzzy filter helpers. The palette is a modal
// overlay that captures focus from whatever area had it before opening.
export function createPaletteHelpers(ctx: UiCoreContext) {
  const { built, focus, palette } = ctx;

  const updatePaletteList = (filter: string): void => {
    // Login-only mode exposes just the setup commands.
    const base =
      ctx.state.auth.state === 'authenticated'
        ? palette.commands
        : palette.commands.filter(
            (c) =>
              c.name.includes('Authenticate') ||
              c.name.includes('Client ID') ||
              c.name.includes('Quit'),
          );
    const available = base.filter((c) => {
      const maybe = c as { isAvailable?: () => boolean };
      return !maybe.isAvailable || maybe.isAvailable();
    });
    const needle = filter.toLowerCase().trim();
    palette.filtered = needle
      ? available.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
        )
      : [...available];
    if (palette.filtered.length === 0) {
      built.paletteList.options = [{ name: '(no matches)', description: '' }];
    } else {
      built.paletteList.options = palette.filtered.map((c) => ({
        name: c.name,
        description: c.description,
      }));
    }
    built.paletteList.setSelectedIndex(0);
  };

  const setPaletteOpen = (open: boolean): void => {
    palette.open = open;
    const termW =
      typeof ctx.termWidth.value === 'number' && ctx.termWidth.value > 0
        ? ctx.termWidth.value
        : (typeof process !== 'undefined' &&
            (process.stdout as unknown as { columns?: number })?.columns) ||
          80;
    const rw = Math.min(60, Math.max(20, termW - 2));
    const left = Math.max(0, Math.floor((termW - rw) / 2));
    const pal = built.palette as unknown as { width?: number; left?: number };
    if (typeof pal.width !== 'undefined') pal.width = rw;
    if (typeof pal.left !== 'undefined') pal.left = left;
    built.palette.visible = open;
    if (open) {
      palette.prevFocus = focus.current;
      blurAllPanels(built);
      if (ctx.menu.open) ctx.helpers.closeContextMenu();
      built.paletteInput.value = '';
      updatePaletteList('');
      built.paletteInput.focus();
    } else {
      built.paletteInput.blur();
      ctx.helpers.setFocusArea(palette.prevFocus);
      if (
        palette.prevFocus === 'main' &&
        (ctx.route.current as { kind?: string }).kind === 'search' &&
        !built.searchInput.focused
      ) {
        built.searchInput.blur();
      }
    }
  };

  return { updatePaletteList, setPaletteOpen };
}
