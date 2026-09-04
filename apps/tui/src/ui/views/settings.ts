import { bold, fg, t } from '@opentui/core';
import { getRedirectUri, resolveClientId } from '../../config';
import { authSummary } from '../formatters';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import type { UiViewState } from '../types';

// Settings is account management only. Authentication lives in the
// onboarding flow; unauthenticated users never land here (nav gate).
export function getSettingsContent(state: UiViewState) {
  const clientRes = resolveClientId();
  const redirectUri = getRedirectUri();

  if (state.auth.state !== 'authenticated') {
    return t`${bold('Account')}
${fg(COLOR_WARN)('Not logged in — authenticate through the onboarding flow.')}

${fg(COLOR_DIM)('Press [Q] to quit')}`;
  }

  return t`${bold('Account')}
${fg(COLOR_TEXT)(authSummary(state.auth))}

${bold('Spotify Client ID')}
${fg(COLOR_SUCCESS)(`Configured (${clientRes.source})`)}
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Storage & Capabilities')}
${fg(COLOR_TEXT)(String(state.auth.storage ?? 'in-memory'))} • ${fg(COLOR_DIM)(state.capabilities.join(', ') || '(none)')}

${fg(COLOR_ACCENT)('To change Client ID, log out first (onboarding will guide you).')}
${fg(COLOR_DIM)('Press [A] to re-authenticate')}`;
}
