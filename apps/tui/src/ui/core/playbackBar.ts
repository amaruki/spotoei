import { bold, fg, t } from '@opentui/core';
import { formatArtists, formatTime } from '../formatters';
import { COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import { getSettingsContent } from '../views/settings';
import { buildPlaybackBarContent } from '../playbackBarView';
import { routeKind } from './navigationStack';
import type { UiCoreContext } from './types';
// Build the live status / progress / footer / header surface. Each
// closure mutates `ctx.state` and refreshes the matching renderable.
export function createPlaybackBarHelpers(ctx: UiCoreContext) {
  const { built, focus, route, state, statusTimer } = ctx;

  const getFooterHelp = (): string => {
    const curKind = routeKind(route.current);
    if (state.auth.state !== 'authenticated') {
      if (curKind === 'settings' && built.clientIdInput.focused) {
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
    if (curKind === 'search') {
      if (built.searchInput.focused) {
        return 'Enter: search Spotify  ↓: results  Tab/Esc: navigation  q: quit';
      }
      return '↑/↓: select  Enter: play/open  x: actions  Tab: category  q: quit';
    }
    if (curKind === 'library' || curKind === 'queue') {
      return '↑/↓: browse list  Enter: play/open  x: actions  r: refresh  q: quit';
    }
    if (curKind === 'lyrics') {
      return '↑/↓: scroll  l/Esc: close lyrics  L: reload lyrics  q: quit';
    }
    if (curKind === 'artist' || curKind === 'album' || curKind === 'playlist') {
      return '↑/↓: browse  Enter: play/open  x: actions  Esc: back  q: quit';
    }
    if (curKind === 'visualizer') {
      return 'V/Esc: back  m: mode  Space: play/pause  q: quit';
    }
    if (curKind === 'home') {
      return '↑/↓: browse  Enter: play/open  x: actions  Tab: panel  q: quit';
    }
    return 'Space: play/pause  n: next  p: prev  l: lyrics  S: shuffle  R: repeat  A: autoplay  +/-: vol  Tab: nav  q: quit';
  };

  const refreshHome = (): void => {
    // Update the Now Playing home panel from live playback state.
    // Never fetches: panel rows arrive through setHomeItems only.
    const pb = state.playback;
    const track = pb?.track;
    if (!track) {
      built.homeNowText.content = t`${fg(COLOR_DIM)('Nothing playing — pick a track from any panel')}`;
      return;
    }
    const pos = formatTime(pb?.positionMs ?? 0);
    const dur = formatTime(pb?.durationMs ?? track.durationMs ?? 0);
    const vol = Math.round((pb?.volume ?? 1) * 100);
    built.homeNowText.content = t`${fg(COLOR_TEXT)(bold(track.name || 'Untitled'))}
${fg(COLOR_TEXT)(formatArtists(track.artists))}${track.album ? fg(COLOR_DIM)(` — ${track.album}`) : ''}
${fg(COLOR_DIM)(`${pb?.state ?? 'idle'} · ${pos} / ${dur} · vol ${vol}% · shuffle ${pb?.shuffle ? 'on' : 'off'} · repeat ${pb?.repeat ?? 'off'}`)}`;
  };

  const refreshSettings = (): void => {
    built.settingsText.content = getSettingsContent(state);
  };

  const renderPlaybackBar = (): void => {
    const pb = state.playback;
    const track = pb?.track;
    const pbState =
      pb?.state === 'playing' ? 'playing' : pb?.state === 'paused' ? 'paused' : 'idle';

    const authIndicator =
      state.auth.state === 'authenticated' ? '● Online' : '○ Offline / Login Required';

    built.playbackBar.title = `Playback [${pbState.toUpperCase()}]  •  Spotoei ${authIndicator}`;

    if (!track) {
      const stateIcon =
        pbState === 'playing'
          ? fg(COLOR_SUCCESS)(bold('▶ PLAYING'))
          : pbState === 'paused'
            ? fg(COLOR_WARN)(bold('⏸ PAUSED'))
            : fg(COLOR_DIM)('■ IDLE');
      built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_DIM)('No track playing — select a song from Library [r] or Search [/]')}`;
      built.playbackProgressText.content = t`${fg(COLOR_DIM)('0:00  ────────────────────────────────────────────────────────────  0:00 (0%)')}`;
      return;
    }

    const width = ctx.termWidth.value;
    const posMs = pb?.positionMs ?? 0;
    const durMs = pb?.durationMs && pb.durationMs > 0 ? pb.durationMs : (track.durationMs ?? 0);
    const content = buildPlaybackBarContent({
      state: pbState,
      title: track.name || 'Untitled',
      artist: formatArtists(track.artists),
      album: track.album,
      positionMs: posMs,
      durationMs: durMs,
      shuffle: pb?.shuffle ?? false,
      repeat: pb?.repeat ?? 'off',
      queueCount: state.queue.upcoming.length,
      volume: Math.round((pb?.volume ?? 1) * 100),
      width,
    });
    built.playbackTrackText.content = t`${fg(COLOR_TEXT)(content.line1)}`;
    built.playbackProgressText.content = t`${fg(COLOR_DIM)(content.line2)}`;
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
