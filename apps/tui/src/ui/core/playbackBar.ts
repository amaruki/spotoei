import { bold, fg, t } from '@opentui/core';
import { formatArtists } from '../formatters';
import { COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import { getOnboardingContent, onboardingStep, shouldShowClientIdBox } from '../views/onboarding';
import { getSettingsContent } from '../views/settings';
import { buildPlaybackBarContent } from '../playbackBarView';
import { QUOTA_BANNER } from '../../webApi/transport';
import { routeKind } from './navigationStack';
import type { UiCoreContext } from './types';
import { optimisticPlayback } from '../../playback/validator';
function refreshHomePanels(): void {}

export function createPlaybackBarHelpers(ctx: UiCoreContext) {
  const { built, focus, route, state, statusTimer } = ctx;
  let playbackTickTimer: NodeJS.Timeout | null = null;
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
    if (curKind === 'settings') {
      return 'Ctrl+L: log out  Ctrl+A: re-authenticate  Tab: nav  ?: palette  q: quit';
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
    built.clientIdBox.visible = shouldShowClientIdBox(onboardingStep(state));
  };

  const renderPlaybackBar = (): void => {
    const pb = optimisticPlayback.getEffectiveState() ?? state.playback;
    const track = pb?.track;
    const pbState =
      pb?.state === 'playing' ? 'playing' : pb?.state === 'paused' ? 'paused' : 'idle';

    const stateLabel =
      pbState === 'playing' ? '▶ Now Playing' : pbState === 'paused' ? '⏸ Paused' : 'Now Playing';
    const privateBadge = state.isPrivateSession ? ' • 🕶 Private' : '';
    built.playbackBar.title = ` ${stateLabel}${privateBadge} `;
    built.playbackBar.titleColor =
      pbState === 'playing' ? COLOR_SUCCESS : pbState === 'paused' ? COLOR_WARN : COLOR_TEXT;
    if (!track) {
      const stateIcon =
        pbState === 'playing'
          ? fg(COLOR_SUCCESS)(bold('▶ PLAYING'))
          : pbState === 'paused'
            ? fg(COLOR_WARN)(bold('⏸ PAUSED'))
            : fg(COLOR_DIM)('■ IDLE');
      built.playbackTrackText.content = t`${stateIcon}  ${fg(COLOR_DIM)('No track playing — select a song from Library [r] or Search [/]')}`;
      const width = ctx.termWidth.value;
      const barLen = Math.max(10, width - 4 - 6 - 12);
      const emptyBar = '─'.repeat(barLen);
      built.playbackCoverBox.visible = false;
      built.playbackProgressText.content = t`${fg(COLOR_DIM)(`0:00 ${emptyBar} 0:00 (0%)`)}`;
      built.statusText.content = t`${fg(COLOR_DIM)('Select a song to start listening')}`;
      if (playbackTickTimer) {
        clearInterval(playbackTickTimer);
        playbackTickTimer = null;
      }
      return;
    }

    const width = ctx.termWidth.value;
    const durMs = pb?.durationMs && pb.durationMs > 0 ? pb.durationMs : (track.durationMs ?? 0);
    let posMs = Math.max(0, pb?.positionMs ?? 0);
    const observedAt = pb?.observedAtMonotonicMs;
    if (pb?.state === 'playing' && observedAt) {
      // Guard against abnormal or monotonic timestamps: if observedAt looks like relative elapsed
      // or far future, clamp elapsed to reasonable bounds [0, 60_000].
      const diff = Date.now() - observedAt;
      const elapsed = observedAt > 1_000_000_000_000 ? Math.max(0, Math.min(60_000, diff)) : 0;
      posMs += elapsed;
    }
    if (durMs > 0) {
      posMs = Math.min(durMs, Math.max(0, posMs));
    }
    const rawImage =
      (track as { imageUrl?: string }).imageUrl ||
      (track as { image?: { url?: string } }).image?.url;
    if (rawImage) {
      built.playbackCoverBox.visible = true;
      if (built.playbackCoverImage.source !== rawImage) {
        built.playbackCoverImage.source = rawImage;
      }
    } else {
      built.playbackCoverBox.visible = false;
    }

    const content = buildPlaybackBarContent({
      state: pbState,
      title: track.name || 'Untitled',
      artist: formatArtists(track.artists),
      album: track.album ?? (track as { albumName?: string }).albumName,
      genre: (track as { genre?: string }).genre,
      hasCoverArt: Boolean(rawImage),
      positionMs: posMs,
      durationMs: durMs,
      shuffle: pb?.shuffle ?? false,
      repeat: pb?.repeat ?? 'off',
      queueCount: state.queue.upcoming.length,
      volume: Math.round((pb?.volume ?? 1) * 100),
      width,
    });
    built.playbackTrackText.content = t`${fg(COLOR_TEXT)(content.line1)}`;
    const barMatch = content.line2.match(/^(\S+\s+)([━]*)([─]*)(\s+\S+\s+\(\d+%\))$/);
    if (barMatch) {
      const [, prefix = '', filled = '', empty = '', suffix = ''] = barMatch;
      built.playbackProgressText.content = t`${fg(COLOR_TEXT)(prefix)}${fg(COLOR_SUCCESS)(filled)}${fg(COLOR_DIM)(empty)}${fg(COLOR_DIM)(suffix)}`;
    } else {
      built.playbackProgressText.content = t`${fg(COLOR_DIM)(content.line2)}`;
    }
    built.statusText.content = t`${fg(COLOR_DIM)(content.line3)}`;

    if (pbState === 'playing') {
      if (!playbackTickTimer) {
        playbackTickTimer = setInterval(() => {
          try {
            const cur = optimisticPlayback.getEffectiveState() ?? state.playback;
            if (cur?.state === 'playing') {
              renderPlaybackBar();
            } else {
              stopPlaybackTickTimer();
            }
          } catch {
            stopPlaybackTickTimer();
          }
        }, 250);
      }
    } else {
      stopPlaybackTickTimer();
    }
  };

  const stopPlaybackTickTimer = (): void => {
    if (playbackTickTimer) {
      clearInterval(playbackTickTimer);
      playbackTickTimer = null;
    }
  };

  const setHeader = (): void => {
    renderPlaybackBar();
  };

  const setStatus = (msg: string, persist = false): void => {
    state.statusMessage = msg;
    const isQuota = msg.includes(QUOTA_BANNER) || /QUOTA_EXCEEDED/i.test(msg) || /quota/i.test(msg);
    try {
      built.statusLayerText.content = t`${fg(COLOR_WARN)(bold(msg))}`;
      built.statusLayer.visible = true;
      clearTimeout(statusTimer.value as unknown as NodeJS.Timeout);
      if (!persist) {
        statusTimer.value = setTimeout(() => {
          state.statusMessage = undefined;
          built.statusLayer.visible = false;
        }, 2500);
      }
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
    stopPlaybackTickTimer,
  };
}
