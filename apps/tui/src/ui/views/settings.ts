import { bold, fg, t } from '@opentui/core';
import { getRedirectUri, resolveClientId } from '../../config';
import { authSummary } from '../formatters';
import { COLOR_ACCENT, COLOR_DIM, COLOR_SUCCESS, COLOR_TEXT, COLOR_WARN } from '../theme';
import type { UiViewState } from '../types';

export function getSettingsContent(state: UiViewState) {
  const clientRes = resolveClientId();
  const redirectUri = getRedirectUri();
  const isAuthenticated = state.auth.state === 'authenticated';

  if (!isAuthenticated) {
    if (!clientRes.clientId) {
      return t`${bold('== SETUP STEP 1 OF 2: Spotify Client ID ==')}
${fg(COLOR_WARN)('Spotoei requires setup & authentication before use.')}

1. Create a free app at: ${fg(COLOR_ACCENT)('https://developer.spotify.com/dashboard')}
2. In App Settings, add Redirect URI:
   ${fg(COLOR_ACCENT)(bold(redirectUri))}
3. Paste your Client ID below and press ${bold('Enter')}.`;
    }
    if (state.auth.state === 'authenticating') {
      return t`${bold('== STEP 2 OF 2: Authenticating ==')}
${fg(COLOR_ACCENT)(bold('Browser opened for authentication!'))}
${fg(COLOR_TEXT)('Complete the login in your browser window.')}

${bold('Redirect URI listening at:')}
${fg(COLOR_SUCCESS)(redirectUri)}

${fg(COLOR_DIM)('Waiting for Spotify login callback…')}
${fg(COLOR_DIM)('Press [A] to re-open browser  •  Press [C] to edit Client ID')}`;
    }
    return t`${bold('== SETUP STEP 2 OF 2: Authenticate ==')}
${fg(COLOR_SUCCESS)('✔ Client ID configured')} (${fg(COLOR_DIM)(clientRes.source)})
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Press [A] or [Enter]')} to open browser and log in with Spotify!
${fg(COLOR_DIM)('Press [C] to edit Client ID  •  Press [Q] to quit')}`;
  }

  return t`${bold('Account')}
${fg(COLOR_TEXT)(authSummary(state.auth))}

${bold('Spotify Client ID')}
${fg(COLOR_SUCCESS)(`Configured (${clientRes.source})`)}
${fg(COLOR_DIM)(`Redirect URI: ${redirectUri}`)}

${bold('Storage & Capabilities')}
${fg(COLOR_TEXT)(String(state.auth.storage ?? 'in-memory'))} • ${fg(COLOR_DIM)(state.capabilities.join(', ') || '(none)')}

${fg(COLOR_DIM)('Press [A] to re-authenticate  •  Press [C] to update Client ID')}`;
}
