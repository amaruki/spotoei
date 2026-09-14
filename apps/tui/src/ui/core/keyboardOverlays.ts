import type { UiCoreContext } from './types';

export interface OverlayKeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

// Palette and context-menu keyboard handling extracted from `keyboard.ts`
// for the 300 LoC cap. Returns true when the event was consumed.
export function handleOverlayKeys(ctx: UiCoreContext, e: OverlayKeyEvent): boolean {
  const { built, palette } = ctx;

  // 1. Palette open takes absolute keyboard precedence
  if (palette.open) {
    if (e.name === 'escape' || (e.ctrl && e.name === 'c')) {
      ctx.helpers.setPaletteOpen(false);
      return true;
    }
    if (e.name === 'tab') return true;
    if (e.name === 'up' || e.name === 'k') {
      const cur = built.paletteList.getSelectedIndex();
      built.paletteList.setSelectedIndex(Math.max(0, cur - 1));
      return true;
    }
    if (e.name === 'down' || e.name === 'j') {
      const cur = built.paletteList.getSelectedIndex();
      const max = Math.max(0, built.paletteList.options.length - 1);
      built.paletteList.setSelectedIndex(Math.min(max, cur + 1));
      return true;
    }
    if (e.name === 'return') {
      if (palette.filtered.length === 0) {
        ctx.helpers.setStatus('No matching command');
        return true;
      }
      const idx = built.paletteList.getSelectedIndex();
      const cmd = palette.filtered[idx];
      ctx.helpers.setPaletteOpen(false);
      if (cmd) {
        try {
          cmd.action();
        } catch (err) {
          ctx.helpers.setStatus(`palette: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return true;
    }
    return true;
  }

  // 1b. Context menu captures keys while open; Esc/X closes it and
  // restores focus to the originating list.
  if (ctx.menu.open) {
    if (e.name === 'escape' || e.name === 'x' || e.name === 'X' || (e.ctrl && e.name === 'c')) {
      ctx.helpers.closeContextMenu();
      return true;
    }
    if (e.name === 'up' || e.name === 'k') {
      const cur = built.menuList.getSelectedIndex();
      built.menuList.setSelectedIndex(Math.max(0, cur - 1));
      return true;
    }
    if (e.name === 'down' || e.name === 'j') {
      const cur = built.menuList.getSelectedIndex();
      const max = Math.max(0, built.menuList.options.length - 1);
      built.menuList.setSelectedIndex(Math.min(max, cur + 1));
      return true;
    }
    if (e.name === 'return') {
      ctx.helpers.runMenuSelected();
      return true;
    }
    return true;
  }

  return false;
}
