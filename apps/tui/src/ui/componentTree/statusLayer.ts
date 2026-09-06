import { BoxRenderable, type CliRenderer, TextRenderable, fg, t } from '@opentui/core';
import { COLOR_PANEL_BG, COLOR_WARN } from '../theme';

export interface StatusLayerNodes {
  statusLayer: BoxRenderable;
  statusLayerText: TextRenderable;
}

export function buildStatusLayer(renderer: CliRenderer): StatusLayerNodes {
  const statusLayer = new BoxRenderable(renderer, {
    id: 'status-layer',
    position: 'absolute',
    top: 1,
    right: 2,
    width: 38,
    height: 3,
    borderStyle: 'rounded',
    borderColor: COLOR_WARN,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Alert ',
    titleColor: COLOR_WARN,
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    visible: false,
    zIndex: 80,
  });
  const statusLayerText = new TextRenderable(renderer, {
    id: 'status-layer-text',
    content: t`${fg(COLOR_WARN)('⚠ ')}`,
    wrapMode: 'word',
    width: '100%',
  });
  statusLayer.add(statusLayerText);
  return { statusLayer, statusLayerText };
}
