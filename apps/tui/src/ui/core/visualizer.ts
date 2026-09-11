import { RGBA, bold, fg, t } from '@opentui/core';
import { COLOR_ACCENT, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import {
  createPeakState,
  drawBars,
  drawWave,
  resetPeakState,
  type OptimizedBufferLike,
} from '../visualizerCanvas';
import type { UiCoreContext } from './types';

// Fullscreen visualizer painter. Frame rendering touches only the
// fullscreen buffer and title; metadata rendering is never triggered here,
// so slow frames cannot block audio or rerender unrelated screens.
export function createVisualizerHelpers(ctx: UiCoreContext) {
  const { built, latestVizFrame, renderer, state } = ctx;
  let lastPaintedMode: string | null = null;
  const peakState = createPeakState();

  const setVizTitle = (): void => {
    const r = renderer as unknown as { targetFps?: number };
    const rendererFps = r.targetFps ?? 60;
    const fps = Math.min(state.visualizer.fps, rendererFps);
    built.visualizerFullTitle.content = t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(fps))}`;
  };

  const paintViz = (): void => {
    const fb = built.visualizerFullFb.frameBuffer;
    const frame = latestVizFrame.value;
    const mode = frame?.mode ?? state.visualizer.mode;
    if (mode !== lastPaintedMode) {
      resetPeakState(peakState);
      lastPaintedMode = mode;
    }
    if (state.visualizer.mode === 'off' || !frame) {
      fb.clear(RGBA.fromHex(COLOR_PANEL_BG));
      return;
    }
    const rawData = frame.data ?? frame.bands ?? [];
    const dataArr = Array.isArray(rawData) ? rawData : Array.from(rawData);
    if (frame.mode === 'spectrum' || frame.mode === 'winamp') {
      drawBars(fb as unknown as OptimizedBufferLike, dataArr, peakState);
    } else {
      drawWave(fb as unknown as OptimizedBufferLike, dataArr);
    }
  };

  // The backing buffer is reallocated (and cleared) whenever the layout size
  // changes — on route entry and on terminal resize. Repaint the last frame
  // so the canvas never flashes blank until the next visualizer event.
  built.visualizerFullFb.onSizeChange = (): void => {
    paintViz();
  };

  return {
    setVizTitle,
    paintViz,
  };
}
