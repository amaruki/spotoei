import { RGBA, bold, fg, t } from '@opentui/core';
import { COLOR_ACCENT, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import {
  createPeakState,
  drawBars,
  drawCircular,
  drawWave,
  resetPeakState,
  type OptimizedBufferLike,
} from '../visualizerCanvas';
import type { UiCoreContext } from './types';

// Best-effort cover URL from the playback projection; the shape mirrors what
// the playback bar already resolves.
function trackCoverUrl(track: unknown): string | null {
  const trk = track as { imageUrl?: string; image?: { url?: string } } | undefined;
  return trk?.imageUrl ?? trk?.image?.url ?? null;
}

// Fullscreen visualizer painter. Frame rendering touches only the
// fullscreen buffer, title, and cover; metadata rendering is never triggered
// here, so slow frames cannot block audio or rerender unrelated screens.
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

  const hideCover = (): void => {
    built.visualizerCoverImage.visible = false;
  };

  // Place the cover art in the middle of the canvas and return the hole
  // diameter (rows) the circular spectrum must leave free for it.
  const placeCover = (coverUrl: string | null, fbW: number, fbH: number): number => {
    const rows = Math.max(4, Math.min(8, Math.floor(fbH / 3)));
    const cols = rows * 2;
    built.visualizerCoverImage.width = cols;
    built.visualizerCoverImage.height = rows;
    built.visualizerCoverImage.left = Math.max(0, Math.floor((fbW - cols) / 2));
    // +1 row: the title sits above the frame buffer inside the same panel.
    built.visualizerCoverImage.top = 1 + Math.max(0, Math.floor((fbH - rows) / 2));
    built.visualizerCoverImage.visible = Boolean(coverUrl);
    if (coverUrl && built.visualizerCoverImage.source !== coverUrl) {
      built.visualizerCoverImage.source = coverUrl;
    }
    return rows;
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
      hideCover();
      fb.clear(RGBA.fromHex(COLOR_PANEL_BG));
      return;
    }
    const rawData = frame.data ?? frame.bands ?? [];
    const dataArr = Array.isArray(rawData) ? rawData : Array.from(rawData);
    if (frame.mode === 'circular') {
      const rows = placeCover(trackCoverUrl(state.playback?.track), fb.width, fb.height);
      drawCircular(fb as unknown as OptimizedBufferLike, dataArr, Math.ceil(rows / 2) + 1);
      return;
    }
    hideCover();
    if (frame.mode === 'spectrum' || frame.mode === 'winamp') {
      // Winamp bars already are the held peak envelope coming from the
      // analyzer, so the extra cap marker would double up the motion.
      drawBars(
        fb as unknown as OptimizedBufferLike,
        dataArr,
        peakState,
        undefined,
        frame.mode !== 'winamp',
      );
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
