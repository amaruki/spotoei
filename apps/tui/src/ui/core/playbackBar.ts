import { bold, fg, t } from '@opentui/core';
import { cap, formatArtists, renderProgressBarStyled } from '../formatters';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import { getHomeContent } from '../views/home';
import { getSettingsContent } from '../views/settings';
import type { UiCoreContext } from './types';

// Build the live status / progress / footer / header surface. Each
// closure mutates `ctx.state` and refreshes the matching renderable.
export function createPlaybackBarHelpers(ctx: UiCoreContext) {
  const { built, focus, route, state, statusTimer } = ctx;

  const getFooterHelp = (): string => {
    if (state.auth.state !== 'authenticated') {
      if (route.current === 'settings' && built.clientIdInput.focused) {
        return 'Enter: save Client ID  Esc/Tab: exit input';
      }
      if (focus.current === 'sidebar') {
        return '↑/↓: navigate  Enter: select view  Tab/→: enter context  A: login  q: quit';
      }
      return 'A: authenticate  c: edit Client ID  Esc/Tab: navigation  q: quit';
    }
    if (focus.current === 'sidebar') {
      return '↑/↓: navigate  Enter: select view  Tab/→: enter view  q: quit';
    }
    if (route.current === 'search') {
      if (built.searchInput.focused) {
        return 'Enter: search Spotify  ↓: results  Tab/Esc: navigation  q: quit';
      }
      return '↑/↓: select track  Enter: play  ↑ at top: edit search  Tab/Esc: navigation  q: quit';
    }
    if (route.current === 'library' || route.current === 'queue') {
      return '↑/↓: browse list  Enter: play  Tab/Esc: navigation  q: quit';
    }
    if (route.current === 'lyrics') {
      return '↑/↓: scroll  l/Esc: close lyrics  L: reload lyrics  q: quit';
    }
    return 'Space: play/pause  n: next  p: prev  l: lyrics  S: shuffle  R: repeat  A: autoplay  +/-: vol  Tab: nav  q: quit';
  };

  const refreshHome = (): void => {
    built.homeText.content = getHomeContent(state);
  };

  const refreshSettings = (): void => {
    built.settingsText.content = getSettingsContent(state);
  };

  const renderPlaybackBar = (): void => {
    const pb = state.playback;
    const track = pb?.track;
    const isPlaying = pb?.state === 'playing';
    const isPaused = pb?.state === 'paused';
    const stateIcon = isPlaying
      ? fg(COLOR_SUCCESS)(bold('▶ PLAYING'))
      : isPaused
        ? fg(COLOR_WARN)(bold('⏸ PAUSED'))
        : fg(COLOR_DIM)('■ IDLE');

    const authIndicator =
      state.auth.state === 'authenticated'
        ? fg(COLOR_SUCCESS)('● Online')
        : fg(COLOR_WARN)('○ Offline / Login Required');

    built.playbackBar.title = `Playback [${pb?.state ? pb.state.toUpperCase() : 'IDLE'}]  •  Spotoei ${authIndicator}`;

    if (!track) {
      built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_DIM)('No track playing — select a song from Library [r] or Search [/]')}`;
      built.playbackProgressText.content = t`${fg(COLOR_DIM)('0:00  ────────────────────────────────────────────────────────────  0:00 (0%)')}`;
      return;
    }

    const title = track.name || 'Untitled';
    const artists = formatArtists(track.artists);
    const album = track.album ?? '—';
    const genre = track.genre ?? '—';

    const vol = Math.round((pb?.volume ?? 1) * 100);
    const shuffle = pb?.shuffle ? 'on' : 'off';
    const repeat = pb?.repeat ?? 'off';

    built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_ACCENT)(bold(cap(title, 28)))}  ${fg(COLOR_DIM)('by')} ${fg(COLOR_TEXT)(cap(artists, 24))}  ${fg(COLOR_DIM)('•')}  ${fg(COLOR_DIM)('Album:')} ${fg(COLOR_TEXT)(cap(album, 20))}  ${fg(COLOR_DIM)('•')}  ${fg(COLOR_DIM)('Genre:')} ${fg(COLOR_SUCCESS)(cap(genre, 16))}  ${fg(COLOR_DIM)(`[Vol: ${vol}% | Shuf: ${shuffle} | Rep: ${repeat}]`)}`;

    const posMs = pb?.positionMs ?? 0;
    const durMs = pb?.durationMs && pb.durationMs > 0 ? pb.durationMs : (track.durationMs ?? 0);
    built.playbackProgressText.content = renderProgressBarStyled(posMs, durMs, 64);
  };

  const setHeader = (): void => {
    renderPlaybackBar();
  };

  const setStatus = (msg: string, persist = false): void => {
    state.statusMessage = msg;
    if (persist) {
      built.statusText.content = t`${fg(COLOR_WARN)(bold(msg))}`;
      return;
    }
    built.statusText.content = t`${fg(COLOR_TEXT)(msg)}  ${fg(COLOR_DIM)(getFooterHelp())}`;
    if (statusTimer.value) clearTimeout(statusTimer.value);
    statusTimer.value = setTimeout(() => {
      state.statusMessage = undefined;
      built.statusText.content = t`${fg(COLOR_DIM)(getFooterHelp())}`;
    }, 2500);
  };

  return { getFooterHelp, refreshHome, refreshSettings, renderPlaybackBar, setHeader, setStatus };
}
