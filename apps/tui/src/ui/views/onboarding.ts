import { bold, fg, t } from '@opentui/core';
import {
  getRedirectUri,
  resolveClientId,
  DEFAULT_CLIENT_ID,
  KEYMASTER_CLIENT_ID,
} from '../../config';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import type { UiViewState } from '../types';

export type OnboardingStep = 'client-id' | 'authenticate' | 'authenticating';

export function onboardingStep(state: UiViewState): OnboardingStep {
  if (!resolveClientId(false).clientId) return 'client-id';
  if (state.auth.state === 'authenticating') return 'authenticating';
  return 'authenticate';
}

/// The Client ID editor lives on the onboarding page, but only on its own
/// step — later steps must not mix account setup into the login flow.
export function shouldShowClientIdBox(step: OnboardingStep): boolean {
  return step === 'client-id';
}

export function getOnboardingContent(state: UiViewState) {
  const clientRes = resolveClientId();
  const redirectUri = getRedirectUri();
  const step = onboardingStep(state);
  const keyringWarning =
    state.auth.storage !== 'keyring' &&
    state.auth.storage !== null &&
    state.auth.storage !== undefined
      ? `\n${fg(COLOR_WARN)('⚠ OS keyring unavailable — login will not persist after quit')}`
      : '';

  if (state.auth.state === 'authenticated' && !state.streamingPending) {
    const accountId = state.auth.accountId ?? 'Unknown';
    const storageEngine = state.auth.storage ?? 'memory';
    const maskedCid = clientRes.clientId
      ? `${clientRes.clientId.slice(0, 6)}…${clientRes.clientId.slice(-4)}`
      : 'Not configured';
    return t`${bold('== Spotify Account & Authorization ==')}${keyringWarning}
${fg(COLOR_SUCCESS)(bold(`Account: ${accountId}`))}

${bold('Connection Status:')}
  ${fg(COLOR_SUCCESS)('✔ Web API')}           Connected (Library, Search, Playlists, Top Tracks)
  ${fg(COLOR_SUCCESS)('✔ Audio Streaming')}   Connected (Local Librespot playback)

${bold('Configuration:')}
  Client ID:         ${fg(COLOR_DIM)(maskedCid)}
  Redirect URI:      ${fg(COLOR_DIM)(redirectUri)}
  Storage Engine:    ${fg(COLOR_DIM)(storageEngine)}

${fg(COLOR_TEXT)('Actions:')}
  ${bold('[L]')} Log out of Spotify  •  ${bold('[C]')} Edit Client ID  •  ${bold('[A]')} Re-authorize  •  ${bold('[Esc]')} Back to Home`;
  }

  if (state.auth.state === 'authenticated' && state.streamingPending) {
    const pendingUrl = state.auth.authUrl;
    return t`${bold('== Step 2 of 2: Audio Streaming Authorization ==')}${keyringWarning}
${fg(COLOR_SUCCESS)('[✔ Step 1/2: Web API Connected]')} ───▶ ${fg(COLOR_ACCENT)(bold('[● Step 2/2: Audio Streaming]'))}

${fg(COLOR_TEXT)('Web API is authorized. Step 2 connects local Librespot playback to Spotify streaming servers.')}

${bold('Press [A] or [Enter]')} to open browser (or re-open tab)!
${fg(COLOR_TEXT)('Complete the authorization in the newest browser tab.')}
${pendingUrl ? `\n${bold('Current login URL:')}\n${fg(COLOR_DIM)(pendingUrl)}\n${fg(COLOR_WARN)('(Only this tab is valid — older tabs are stale.)')}` : ''}

${fg(COLOR_DIM)('Press [C] to edit Client ID  •  Press [Q] to quit  •  ?: palette')}`;
  }

  if (step === 'client-id') {
    return t`${bold('== Welcome to Spotoei — Step 1 of 2: Spotify Client ID ==')}${keyringWarning}
${fg(COLOR_TEXT)('Spotoei connects to Spotify Web API using your own app credentials.')}
${fg(COLOR_SUCCESS)('Creating your own Spotify Developer App gives you dedicated API quota and avoids 429 Rate Limits.')}

1. Create a free app at: ${fg(COLOR_ACCENT)('https://developer.spotify.com/dashboard')}
2. In App Settings, add Redirect URI exactly:
   ${fg(COLOR_ACCENT)(bold(redirectUri))}  ${fg(COLOR_WARN)('(use 127.0.0.1, not localhost)')}
3. Paste your Client ID below and press ${bold('Enter')}.

${fg(COLOR_DIM)('Or press [D] to use the default shared Client ID (higher risk of 429 Rate Limits).')}`;
  }

  const isKeymaster = clientRes.clientId === KEYMASTER_CLIENT_ID;

  if (step === 'authenticating') {
    const header = isKeymaster
      ? '== Authenticating with Spotify =='
      : '== Step 2 of 2: Authenticating ==';
    const pendingUrl = state.auth.authUrl;
    return t`${bold(header)}${keyringWarning}
${fg(COLOR_ACCENT)(bold('Browser opened for authentication!'))}
${fg(COLOR_TEXT)('Complete the login in your browser window.')}

${bold('Redirect URI listening at:')}
${fg(COLOR_SUCCESS)(redirectUri)} ${fg(COLOR_DIM)('(127.0.0.1 — ensure Dashboard lists exactly this URI)')}
${pendingUrl ? `\n${bold('Current login URL:')}\n${fg(COLOR_DIM)(pendingUrl)}\n${fg(COLOR_WARN)('(Only this tab is valid — older tabs are stale.)')}` : ''}

${fg(COLOR_DIM)('Waiting for Spotify login callback…')}
${fg(COLOR_DIM)('Press [A] to re-open browser  •  Press [C] to edit Client ID')}`;
  }

  const isDefault =
    clientRes.clientId === DEFAULT_CLIENT_ID || clientRes.clientId === KEYMASTER_CLIENT_ID;

  if (isDefault) {
    return t`${bold('== Welcome to Spotoei — Spotify Login ==')}${keyringWarning}
${fg(COLOR_SUCCESS)('✔ Default Shared Client configured')} ${fg(COLOR_WARN)('(Subject to shared API rate limits)')}
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Press [A] or [Enter]')} to log in with Spotify!
${fg(COLOR_DIM)('Press [C] to use custom Client ID  •  Press [Q] to quit  •  ?: palette')}`;
  }

  return t`${bold('== Welcome to Spotoei — Spotify Setup ==')}${keyringWarning}
${fg(COLOR_DIM)('[○ Step 1/2: Web API] ─────── [○ Step 2/2: Audio Streaming]')}

${fg(COLOR_SUCCESS)('✔ Custom Client ID configured')} (${fg(COLOR_DIM)('Dedicated Web API + Librespot Streaming')})
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Press [A] or [Enter]')} to start authentication!
${fg(COLOR_TEXT)('Note: Setup requires two brief browser permissions (Web API + Streaming audio).')}
${fg(COLOR_DIM)('Press [C] to edit Client ID  •  Press [Q] to quit  •  ?: palette')}`;
}

export function onboardingHint(state: UiViewState): string {
  if (state.auth.state === 'authenticated') {
    return state.streamingPending
      ? 'A/Enter: authorize streaming  c: edit Client ID  q: quit  ?: palette'
      : 'l: log out  c: edit Client ID  Esc: back to Home  ?: palette';
  }
  return onboardingStep(state) === 'client-id'
    ? 'Enter: save Client ID  d: use default  Esc/Tab: exit input  q: quit  ?: palette'
    : 'A/Enter: authenticate  c: edit Client ID  q: quit  ?: palette';
}
