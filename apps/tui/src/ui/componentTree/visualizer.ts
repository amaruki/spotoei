import {
  BoxRenderable,
  type CliRenderer,
  FrameBufferRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from '@opentui/core';
import { COLOR_ACCENT, COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT } from '../theme';
import type { UiViewState } from '../types';

export interface VisualizerNodes {
  right: BoxRenderable;
  visualizerTitle: TextRenderable;
  visualizerFb: FrameBufferRenderable;
}

export function buildVisualizer(renderer: CliRenderer, state: UiViewState): VisualizerNodes {
  const right = new BoxRenderable(renderer, {
    id: 'right',
    width: 36,
    flexShrink: 0,
    borderStyle: 'single',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Visualizer',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
  });
  const visualizerTitle = new TextRenderable(renderer, {
    id: 'viz-title',
    content: t`${fg(COLOR_DIM)('mode: ')}${fg(COLOR_ACCENT)(bold(state.visualizer.mode))}  ${fg(COLOR_DIM)('fps: ')}${fg(COLOR_TEXT)(String(state.visualizer.fps))}`,
  });
  right.add(visualizerTitle);
  const visualizerFb = new FrameBufferRenderable(renderer, {
    id: 'viz-fb',
    width: 32,
    height: 10,
  });
  right.add(visualizerFb);
  return { right, visualizerTitle, visualizerFb };
}
