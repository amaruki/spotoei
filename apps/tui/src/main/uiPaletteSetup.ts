import type { ContextTarget, Ui } from '../ui/types';
import { buildPaletteCommands } from './paletteCommands';
import { runContextAction } from './contextMenuItems';
import type { AppContext } from './types';
import type { UiInitActions } from './uiActions';

export function createCycleVisualizerMode(ctx: AppContext): () => void {
  const { clients, state, getUi } = ctx;
  return (): void => {
    const next = clients.visualizer.cycleMode();
    state.currentInfo.visualizer = { mode: next, fps: clients.visualizer.getCurrentFps() };
    const u = getUi();
    if (u) {
      u.setVisualizerFrame(null);
      u.setStatus(`Visualizer mode: ${next}`);
    }
  };
}

export function installPaletteCommands(
  ctx: AppContext,
  actions: UiInitActions,
  cycleVisualizerMode: () => void,
  getUi: () => Ui | null,
  quit: () => Promise<void>,
  ui: Ui,
): void {
  const contextDeps = {
    ...ctx,
    contextActions: {
      playTrackOrContext: actions.playTrackOrContext,
      updateQueueView: actions.updateQueueView,
      ensureAutoplayTracks: actions.ensureAutoplayTracks,
      playRadio: actions.playRadio,
    },
  };
  const runPaletteAction = (action: string, target: ContextTarget): void => {
    void runContextAction(contextDeps, getUi, action, target);
  };

  ui.setPaletteCommands(
    buildPaletteCommands(ctx, { ...actions, cycleVisualizerMode }, getUi, quit, {
      getTarget: () => getUi()?.getContextTarget() ?? null,
      run: runPaletteAction,
      notify: (msg) => getUi()?.setStatus(msg),
    }),
  );
}
