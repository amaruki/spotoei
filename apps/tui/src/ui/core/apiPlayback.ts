// @ts-nocheck
// Playback setters extracted from api.ts for the 300 LoC cap.

import type { PlaybackPositionDataT } from 'spotoei-protocol';

import { optimisticPlayback } from '../../playback/validator';
import { renderLyricsStyled } from '../views/lyrics';
import { routeKind } from './navigationStack';
import type { PlaybackChangedDataT, UiCoreContext } from './types';

export function createPlaybackSetters(ctx: UiCoreContext) {
  const { built, manualLyricsScroll, route, state } = ctx;
  const { helpers } = ctx;

  return {
    setPlayback(playback: PlaybackChangedDataT | null): void {
      state.playback = playback;
      helpers.setHeader();
      helpers.refreshHome();
    },
    setPlaybackPosition(pos: PlaybackPositionDataT): void {
      optimisticPlayback.updatePosition(pos);
      if (!state.playback) return;
      if (
        state.playback.state !== 'playing' &&
        state.playback.state !== 'loading' &&
        pos.revision !== state.playback.revision
      )
        return;
      state.playback.positionMs = pos.positionMs;
      // Store wall-clock observedAt for interpolation; playbackBar computes
      // displayPos as positionMs + elapsed since observedAt when playing.
      state.playback.observedAtMonotonicMs = Date.now();
      helpers.setHeader();
      helpers.refreshHome();
      if (
        routeKind(route.current) === 'lyrics' &&
        !manualLyricsScroll.value &&
        state.lyrics?.kind === 'synced'
      ) {
        const availWidth = Math.max(
          20,
          (ctx.termWidth.value ?? 80) - (built.sidebar.visible ? 32 : 8),
        );
        const availHeight = ctx.renderer.height ?? 24;
        built.lyricsText.content = renderLyricsStyled(state, {
          width: availWidth,
          height: availHeight,
        });
        built.lyricsScroll.scrollTo(0);
      }
    },
  };
}
