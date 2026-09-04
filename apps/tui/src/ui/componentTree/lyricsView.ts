import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
  fg,
  t,
} from '@opentui/core';
import { COLOR_DIM } from '../theme';

export interface LyricsViewNodes {
  lyrics: BoxRenderable;
  lyricsScroll: ScrollBoxRenderable;
  lyricsText: TextRenderable;
}

export function buildLyricsView(renderer: CliRenderer): LyricsViewNodes {
  const lyrics = new BoxRenderable(renderer, {
    id: 'view-lyrics',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    visible: false,
  });
  const lyricsScroll = new ScrollBoxRenderable(renderer, {
    id: 'lyrics-scroll',
    width: '100%',
    flexGrow: 1,
  });
  const lyricsText = new TextRenderable(renderer, {
    id: 'lyrics-text',
    content: t`${fg(COLOR_DIM)('(no lyrics loaded — press L to fetch)')}`,
    wrapMode: 'word',
    width: '100%',
  });
  lyricsScroll.add(lyricsText);
  lyrics.add(lyricsScroll);
  return { lyrics, lyricsScroll, lyricsText };
}
