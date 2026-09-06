import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
  fg,
  t,
} from '@opentui/core';
import { COLOR_ACCENT, COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG } from '../theme';

export interface LyricsViewNodes {
  lyrics: BoxRenderable;
  lyricsScroll: ScrollBoxRenderable;
  lyricsText: TextRenderable;
  lyricsResumeHint: TextRenderable;
}

export function buildLyricsView(renderer: CliRenderer): LyricsViewNodes {
  const lyrics = new BoxRenderable(renderer, {
    id: 'view-lyrics',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'rounded',
    borderColor: COLOR_BORDER,
    backgroundColor: COLOR_PANEL_BG,
    title: ' Synced Lyrics (Enter/r: resume sync, l/Esc: close) ',
    titleColor: COLOR_ACCENT,
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
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
  const lyricsResumeHint = new TextRenderable(renderer, {
    id: 'lyrics-resume-hint',
    content: t`${fg(COLOR_DIM)('↻ Press r / Enter to resume sync — auto-resumes in 5s')}`,
    wrapMode: 'word',
    width: '100%',
    visible: false,
  });
  lyrics.add(lyricsResumeHint);
  return { lyrics, lyricsScroll, lyricsText, lyricsResumeHint };
}
