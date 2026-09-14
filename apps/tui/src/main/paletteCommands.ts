import type { ContextTarget, Ui } from '../ui/types';
import { buildPaletteAccountCommands, buildPaletteSetupCommand } from './paletteAccountCommands';
import { contextActionCommands } from './paletteContextActions';
import { buildPaletteNavCommands } from './paletteNavCommands';
import { buildPalettePlaybackCommands } from './palettePlaybackCommands';
import type { PaletteActionDeps, PaletteCommand } from './paletteTypes';
import type { AppContext } from './types';

export type { PaletteActionDeps, PaletteCommand } from './paletteTypes';

// Full command-palette list extracted from main/ui.ts for the LoC cap.
export function buildPaletteCommands(
  ctx: AppContext,
  actions: PaletteActionDeps,
  getUi: () => Ui | null,
  quit: () => Promise<void>,
  paletteContext?: {
    getTarget: () => ContextTarget | null;
    run: (action: string, target: ContextTarget) => void;
    notify: (msg: string) => void;
  },
): PaletteCommand[] {
  return [
    ...buildPaletteNavCommands(ctx, actions, getUi),
    ...(paletteContext
      ? contextActionCommands(paletteContext.getTarget, paletteContext.run, paletteContext.notify)
      : []),
    buildPaletteSetupCommand(ctx, getUi),
    ...buildPalettePlaybackCommands(ctx, actions, getUi),
    ...buildPaletteAccountCommands(ctx, actions, getUi, quit),
  ];
}
