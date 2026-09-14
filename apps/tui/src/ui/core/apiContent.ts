// @ts-nocheck
// Lyrics and search-loading setters extracted from api.ts for the 300 LoC cap.

import { fg, t } from '@opentui/core';

import { COLOR_DIM } from '../theme';
import { renderLyricsStyled } from '../views/lyrics';
import type { LyricsDocumentT, UiCoreContext } from './types';

export function createContentSetters(ctx: UiCoreContext) {
  const { built, manualLyricsScroll, state } = ctx;

  return {
    setLyrics(doc: LyricsDocumentT | null): void {
      state.lyrics = doc ?? undefined;
      const availWidth = Math.max(
        20,
        (ctx.termWidth.value ?? 80) - (built.sidebar.visible ? 32 : 8),
      );
      const availHeight = ctx.renderer.height ?? 24;
      built.lyricsText.content = renderLyricsStyled(state, {
        width: availWidth,
        height: availHeight,
      });
      const isSynced = doc?.kind === 'synced';
      built.lyricsResumeHint.visible = manualLyricsScroll.value && isSynced;
      if (!isSynced) {
        manualLyricsScroll.value = false;
        if (ctx.lyricsResumeTimer?.value)
          clearTimeout(ctx.lyricsResumeTimer.value as unknown as NodeJS.Timeout);
        if (ctx.lyricsResumeTimer) ctx.lyricsResumeTimer.value = null;
      }
    },
    setSearchLoading(loading: boolean): void {
      // A new query wipes stale hits; background refreshes never call this,
      // so prior results stay visible until setSearchResults arrives.
      if (loading) {
        built.statusText.content = t`${fg(COLOR_DIM)('searching Spotify…')}`;
        const row = {
          name: 'Searching Spotify…',
          description: 'Please wait while querying Spotify Web API',
        };
        for (const list of [
          built.searchTracksList,
          built.searchArtistsList,
          built.searchAlbumsList,
          built.searchPlaylistsList,
        ]) {
          list.options = [row];
          list.setSelectedIndex(0);
        }
      }
    },
  };
}
