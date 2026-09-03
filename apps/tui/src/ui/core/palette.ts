import type { UiCoreContext } from './types';

// Command palette state / fuzzy filter helpers. The palette is a modal
// overlay that captures focus from whatever area had it before opening.
export function createPaletteHelpers(ctx: UiCoreContext) {
  const { built, focus, palette } = ctx;

  const updatePaletteList = (filter: string): void => {
    const needle = filter.toLowerCase().trim();
    palette.filtered = needle
      ? palette.commands.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
        )
      : [...palette.commands];
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
    built.palette.visible = open;
    if (open) {
      palette.prevFocus = focus.current;
      built.paletteInput.value = '';
      updatePaletteList('');
      built.paletteInput.focus();
    } else {
      built.paletteInput.blur();
      ctx.helpers.setFocusArea(palette.prevFocus);
    }
  };

  return { updatePaletteList, setPaletteOpen };
}
