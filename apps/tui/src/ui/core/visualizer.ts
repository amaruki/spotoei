import { RGBA, bold, fg, t } from '@opentui/core';
import {
  COLOR_ACCENT,
  COLOR_DIM,
  COLOR_PANEL_BG,
  COLOR_TEXT,
} from '../theme';
import { drawBars, drawWave, type OptimizedBufferLike } from '../visualizerCanvas';
import type { UiCoreContext } from './types';

// Visualizer title painter + visibility toggles. The actual spectrum/wave
// drawing is in `visualizerCanvas.ts`; this file just wires the helpers to
// the build tree and the latest frame buffer.
export function createVisualizerHelpers(ctx: UiCoreContext) {
  const { built, latestVizFrame, state, visualizerVisible } = ctx;

  const setVizTitle = (): void => {
    built.visualizerTitle.content = t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`;
  };

  const paintViz = (): void => {
    if (!visualizerVisible.value) return;
    const fb = built.visualizerFb.frameBuffer;
    if (state.visualizer.mode === 'off' || !latestVizFrame.value) {
      fb.clear(RGBA.fromHex(COLOR_PANEL_BG));
      return;
    }
    if (latestVizFrame.value.mode === 'spectrum') {
      drawBars(fb as unknown as OptimizedBufferLike, latestVizFrame.value.data);
    } else {
      drawWave(fb as unknown as OptimizedBufferLike, latestVizFrame.value.data);
    }
  };

  const setVisualizerVisible = (visible: boolean): void => {
    visualizerVisible.value = visible;
    built.right.visible = visible;
    if (visible) {
      paintViz();
    }
  };

  const toggleVisualizer = (): boolean => {
    setVisualizerVisible(!visualizerVisible.value);
    return visualizerVisible.value;
  };

  const isVisualizerVisible = (): boolean => visualizerVisible.value;

  return {
    setVizTitle,
    paintViz,
    setVisualizerVisible,
    toggleVisualizer,
    isVisualizerVisible,
  };
}
