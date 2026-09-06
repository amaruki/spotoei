import { bold, fg, t } from '@opentui/core';
import { getRedirectUri, resolveClientId } from '../../config';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import type { UiViewState } from '../types';

export type OnboardingStep = 'client-id' | 'authenticate' | 'authenticating';

export function onboardingStep(state: UiViewState): OnboardingStep {
  if (!resolveClientId().clientId) return 'client-id';
  if (state.auth.state === 'authenticating') return 'authenticating';
  return 'authenticate';
}

export function getOnboardingContent(state: UiViewState) {
  const clientRes = resolveClientId();
  const redirectUri = getRedirectUri();
  const step = onboardingStep(state);
  const keyringWarning =
    state.auth.storage !== 'keyring' && state.auth.storage !== null && state.auth.storage !== undefined
      ? `\n${fg(COLOR_WARN)('⚠ OS keyring unavailable — login will not persist after quit')}`
      : '';

  if (step === 'client-id') {
    return t`${bold('== Welcome to Spotoei — Step 1 of 2: Spotify Client ID ==')}${keyringWarning}
${fg(COLOR_TEXT)('Spotoei needs a Spotify app of yours to talk to the Web API.')}
${fg(COLOR_WARN)('Do not reuse a shared/public Client ID — use only your own app ID.')}

1. Create a free app at: ${fg(COLOR_ACCENT)('https://developer.spotify.com/dashboard')}
2. In App Settings, add Redirect URI exactly:
   ${fg(COLOR_ACCENT)(bold(redirectUri))}  ${fg(COLOR_WARN)('(use 127.0.0.1, not localhost)')}
3. Paste your Client ID below and press ${bold('Enter')}.`;
  }
  if (step === 'authenticating') {
    return t`${bold('== Step 2 of 2: Authenticating ==')}${keyringWarning}
${fg(COLOR_ACCENT)(bold('Browser opened for authentication!'))}
${fg(COLOR_TEXT)('Complete the login in your browser window.')}

${bold('Redirect URI listening at:')}
${fg(COLOR_SUCCESS)(redirectUri)} ${fg(COLOR_DIM)('(127.0.0.1 — ensure Dashboard lists exactly this URI)')}

${fg(COLOR_DIM)('Waiting for Spotify login callback…')}
${fg(COLOR_DIM)('Press [A] to re-open browser  •  Press [C] to edit Client ID')}`;
  }
  return t`${bold('== Welcome to Spotoei — Step 2 of 2: Authenticate ==')}${keyringWarning}
${fg(COLOR_SUCCESS)('✔ Client ID configured')} (${fg(COLOR_DIM)(clientRes.source ?? '')})
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri} (127.0.0.1, not localhost)`)}

${bold('Press [A] or [Enter]')} to open browser and log in with Spotify!
${fg(COLOR_DIM)('Press [C] to edit Client ID  •  Press [Q] to quit  •  ?: palette')}`;
}

export function onboardingHint(state: UiViewState): string {
  if (state.auth.state === 'authenticated') return '';
  return onboardingStep(state) === 'client-id'
    ? 'c: edit Client ID  q: quit  ?: palette'
    : 'A/Enter: authenticate  c: edit Client ID  q: quit  ?: palette';
}
