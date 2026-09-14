// @ts-nocheck
// Palette setters extracted from api.ts for the 300 LoC cap.

import type { UiCoreContext } from './types';

export function createPaletteSetters(ctx: UiCoreContext) {
  const { palette } = ctx;
  const { helpers } = ctx;

  return {
    setPaletteCommands(
      cmds: Array<{
        name: string;
        description: string;
        action: () => void;
        isAvailable?: () => boolean;
      }>,
    ): void {
      palette.commands = cmds as typeof palette.commands;
      palette.filtered = [...cmds] as typeof palette.filtered;
    },
    openPalette(): void {
      helpers.setPaletteOpen(true);
    },
    closePalette(): void {
      helpers.setPaletteOpen(false);
    },
    isPaletteOpen(): boolean {
      return palette.open;
    },
  };
}
