import { bold, fg, t } from '@opentui/core';
import { formatArtists } from '../formatters';
import { COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import { getOnboardingContent } from '../views/onboarding';
import { getSettingsContent } from '../views/settings';
import { buildPlaybackBarContent } from '../playbackBarView';
import { QUOTA_BANNER } from '../../webApi/transport';
import { routeKind } from './navigationStack';
import type { UiCoreContext } from './types';
import { optimisticPlayback } from '../../playback/validator';
function refreshHomePanels(): void {
}

export function createPlaybackBarHelpers(ctx: UiCoreContext) {
  const { built, focus, route, state, statusTimer } = ctx;

  const getFooterHelp = (): string => {
    const curKind = routeKind(route.current);
    if (state.auth.state !== 'authenticated') {
      if (built.clientIdInput.focused) {
        return 'Enter: save Client ID  Esc/Tab: exit input  ?: palette';
      }
      return 'A/Enter: authenticate  c: edit Client ID  q: quit  ?: palette';
    }
    if (focus.current === 'sidebar') {
      return '↑/↓: navigate  Enter: select view  Tab/→: enter view  q: quit  ?: palette';
    }
    if (curKind === 'search') {
      if (built.searchInput.focused) {
        return 'Enter: search Spotify  ↓: results  Tab/Esc: navigation  q: quit  ?: palette';
      }
      return '↑/↓: select  Enter: play/open  x: actions  Tab: category  ?: palette  q: quit';
    }
    if (curKind === 'library' || curKind === 'queue') {
      return '↑/↓: browse list  Enter: play/open  x: actions  r: refresh  ?: palette  q: quit';
    }
    if (curKind === 'lyrics') {
      return '↑/↓: scroll  r/Enter: resume sync  l/Esc: close lyrics  L: reload  ?: palette  q: quit';
    }
    if (curKind === 'artist' || curKind === 'album' || curKind === 'playlist') {
      return '↑/↓: browse  Enter: play/open  x: actions  Esc: back  ?: palette  q: quit';
    }
    if (curKind === 'visualizer') {
      return 'V/Esc: back  m: mode  Space: play/pause  ?: palette  q: quit';
    }
    if (curKind === 'home') {
      return '↑/↓: browse  Enter: play/open  x: actions  Tab: panel  ?: palette  q: quit';
    }
    return 'Space: play/pause  n: next  p: prev  l: lyrics  S: shuffle  R: repeat  A: autoplay  +/-: vol  Tab: nav  ?: palette  q: quit';
  };

  const refreshHome = (): void => {
    refreshHomePanels();
  };

  const refreshSettings = (): void => {
    built.settingsText.content = getSettingsContent(state);
  };

  const refreshOnboarding = (): void => {
    built.onboardingText.content = getOnboardingContent(state);
  };

  const renderPlaybackBar = (): void => {
    const pb = optimisticPlayback.getEffectiveState() ?? state.playback;
    const track = pb?.track;
    const pbState =
      pb?.state === 'playing' ? 'playing' : pb?.state === 'paused' ? 'paused' : 'idle';

    const authIndicator =
      state.auth.state === 'authenticated' ? '● Online' : '○ Offline / Login Required';

    const privateBadge = state.isPrivateSession ? '  •  🕶 [Private]' : '';
    built.playbackBar.title = ` Playback [${pbState.toUpperCase()}]  •  Spotoei ${authIndicator}${privateBadge} `;
    built.playbackBar.titleColor = pbState === 'playing' ? COLOR_SUCCESS : pbState === 'paused' ? COLOR_WARN : COLOR_TEXT;
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
    const durMs = pb?.durationMs && pb.durationMs > 0 ? pb.durationMs : (track.durationMs ?? 0);
    let posMs = pb?.positionMs ?? 0;
    const observedAt = pb?.observedAtMonotonicMs;
    if (pb?.state === 'playing' && observedAt) {
      const elapsed = Date.now() - observedAt;
      posMs = durMs > 0 ? Math.min(durMs, posMs + elapsed) : posMs + elapsed;
    }
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
    const isQuota = msg.includes(QUOTA_BANNER) || /QUOTA_EXCEEDED/i.test(msg) || /quota/i.test(msg);
    const useLayer = persist || isQuota;
    try {
      if (useLayer) {
        built.statusLayerText.content = t`${fg(COLOR_WARN)(bold(`⚠ ${msg}`))}`;
        built.statusLayer.visible = true;
        built.statusText.content = t`${fg(COLOR_DIM)(getFooterHelp())}`;
        return;
      }
      if (built.statusLayer.visible) {
        built.statusLayer.visible = false;
      }
      built.statusText.content = t`${fg(COLOR_DIM)(msg)}`;
      clearTimeout(statusTimer.value as unknown as NodeJS.Timeout);
      statusTimer.value = setTimeout(() => {
        state.statusMessage = undefined;
        try {
          built.statusText.content = t`${fg(COLOR_DIM)(getFooterHelp())}`;
        } catch {
        }
      }, 2500);
    } catch {
      if (persist) process.stderr.write(`${msg}\n`);
    }
  };

  const clearStatusLayer = (): void => {
    built.statusLayer.visible = false;
    state.statusMessage = undefined;
  };

  return {
    getFooterHelp,
    refreshHome,
    refreshSettings,
    refreshOnboarding,
    renderPlaybackBar,
    setHeader,
    setStatus,
    clearStatusLayer,
  };
}
