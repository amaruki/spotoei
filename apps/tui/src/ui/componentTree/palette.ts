import { BoxRenderable, type CliRenderer, InputRenderable, SelectRenderable, TextRenderable, fg, t } from '@opentui/core';
import { COLOR_BORDER_FOCUS, COLOR_DIM, COLOR_PANEL_BG } from '../theme';

export interface PaletteNodes {
  palette: BoxRenderable;
  paletteInput: InputRenderable;
  paletteList: SelectRenderable;
  paletteStatus: TextRenderable;
}
export function buildPalette(renderer: CliRenderer): PaletteNodes {
  const palette = new BoxRenderable(renderer, {
    id: 'palette',
    position: 'absolute',
    top: 4,
    left: 6,
    width: 60,
    borderStyle: 'double',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Command Palette',
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    visible: false,
    zIndex: 100,
  });
  const paletteInput = new InputRenderable(renderer, {
    id: 'palette-input',
    placeholder: 'Type to filter commands…',
    width: '100%',
  });
  const paletteList = new SelectRenderable(renderer, {
    id: 'palette-list',
    options: [],
    showScrollIndicator: true,
    showDescription: true,
    width: '100%',
    height: 8,
  });
  const paletteStatus = new TextRenderable(renderer, {
    id: 'palette-status',
    content: t`${fg(COLOR_DIM)('↑/↓ navigate • Enter execute • Esc close')}`,
  });
  palette.add(paletteInput);
  palette.add(paletteList);
  palette.add(paletteStatus);
  return { palette, paletteInput, paletteList, paletteStatus };
}
