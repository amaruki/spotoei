import { bold, fg, t } from '@opentui/core';
import { getCacheDir } from '../../config';
import { authSummary } from '../formatters';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import type { UiViewState } from '../types';

// Settings is device and account info only. Authentication lives on its own
// onboarding page; unauthenticated users never land here (nav gate).
export function getSettingsContent(state: UiViewState) {
  if (state.auth.state !== 'authenticated') {
    return t`${bold('Account')}
${fg(COLOR_WARN)('Not logged in — authenticate through the onboarding flow.')}

${fg(COLOR_DIM)('Press [Q] to quit')}`;
  }

  const audioCfg = state.audioConfig;
  const deviceMode =
    audioCfg?.deviceMode === 'connect_only' ? 'Connect Only (Remote)' : 'Integrated (Local Audio)';
  const backend = audioCfg?.audioBackend ?? 'rodio (default)';
  const bitrate = audioCfg?.bitrate ? `${audioCfg.bitrate} kbps` : '320 kbps (High)';
  const crossfade =
    audioCfg?.crossfadeDurationMs !== undefined
      ? audioCfg.crossfadeDurationMs > 0
        ? `${(audioCfg.crossfadeDurationMs / 1000).toFixed(1)}s (${audioCfg.crossfadeDurationMs} ms)`
        : 'Off'
      : 'Off';
  const normalisation = audioCfg?.normalisation === false ? 'Disabled' : 'Enabled';
  const pregain =
    audioCfg?.pregain !== undefined
      ? ` (${audioCfg.pregain > 0 ? '+' : ''}${audioCfg.pregain} dB)`
      : '';
  const cachePath = audioCfg?.cachePath ?? getCacheDir();

  return t`${bold('Account')}
${fg(COLOR_TEXT)(authSummary(state.auth))}

${bold('Audio Engine & Librespot')}
${fg(COLOR_TEXT)('Device Mode:')} ${fg(COLOR_SUCCESS)(deviceMode)}
${fg(COLOR_TEXT)('Audio Backend:')} ${fg(COLOR_TEXT)(backend)}
${fg(COLOR_TEXT)('Bitrate (320/160/96k):')} ${fg(COLOR_ACCENT)(bitrate)}
${fg(COLOR_TEXT)('Crossfade:')} ${fg(COLOR_TEXT)(crossfade)}
${fg(COLOR_TEXT)('Normalisation:')} ${fg(COLOR_TEXT)(`${normalisation}${pregain}`)}
${fg(COLOR_DIM)(`Cache: ${cachePath}`)}

${bold('Storage & Capabilities')}
${fg(COLOR_TEXT)(String(state.auth.storage ?? 'in-memory'))} • ${fg(COLOR_DIM)(state.capabilities.join(', ') || '(none)')}
`;
}
