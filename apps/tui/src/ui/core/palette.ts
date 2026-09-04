import type { UiCoreContext } from './types';

// Command palette state / fuzzy filter helpers. The palette is a modal
// overlay that captures focus from whatever area had it before opening.
export function createPaletteHelpers(ctx: UiCoreContext) {
  const { built, focus, palette } = ctx;

  const updatePaletteList = (filter: string): void => {
    // Login-only mode exposes just the setup commands.
    const available =
      ctx.state.auth.state === 'authenticated'
        ? palette.commands
        : palette.commands.filter(
            (c) =>
              c.name.includes('Authenticate') ||
              c.name.includes('Client ID') ||
              c.name.includes('Quit'),
          );
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
    // Responsive sizing: use min(60, w-2) so narrow terminals don't clip.
    const w = ctx.termWidth.value;
    const rw = Math.min(60, w - 2);
    if (typeof (built.palette as unknown as { width?: unknown }).width !== 'undefined') {
      (built.palette as unknown as { width: number }).width = rw > 0 ? rw : 20;
    }
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
