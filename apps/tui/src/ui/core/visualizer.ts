import { RGBA, bold, fg, t } from '@opentui/core';
import { COLOR_ACCENT, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import { drawBars, drawWave, type OptimizedBufferLike } from '../visualizerCanvas';
import type { UiCoreContext } from './types';

// Fullscreen visualizer painter. Frame rendering touches only the
// fullscreen buffer and title; metadata rendering is never triggered here,
// so slow frames cannot block audio or rerender unrelated screens.
export function createVisualizerHelpers(ctx: UiCoreContext) {
  const { built, latestVizFrame, state } = ctx;

  const setVizTitle = (): void => {
    built.visualizerFullTitle.content = t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`;
  };

  const paintViz = (): void => {
    const fb = built.visualizerFullFb.frameBuffer;
    if (state.visualizer.mode === 'off' || !latestVizFrame.value) {
      fb.clear(RGBA.fromHex(COLOR_PANEL_BG));
      return;
    }
    const rawData = latestVizFrame.value.data ?? latestVizFrame.value.bands ?? [];
    const dataArr = Array.isArray(rawData) ? rawData : Array.from(rawData);
    if (latestVizFrame.value.mode === 'spectrum') {
      drawBars(fb as unknown as OptimizedBufferLike, dataArr);
    } else {
      drawWave(fb as unknown as OptimizedBufferLike, dataArr);
    }
  };

  return {
    setVizTitle,
    paintViz,
  };
}
