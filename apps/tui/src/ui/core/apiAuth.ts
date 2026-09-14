// @ts-nocheck
// Auth and streaming-pending setters extracted from api.ts for the 300 LoC cap.

import type { AuthStatusDataT } from 'spotoei-protocol';

import type { UiCoreContext } from './types';

export function createAuthSetters(ctx: UiCoreContext) {
  const { state } = ctx;
  const { helpers } = ctx;

  return {
    setAuth(auth: AuthStatusDataT): void {
      const wasAuth = state.auth.state === 'authenticated';
      state.auth = auth;
      helpers.setHeader();
      helpers.refreshSettings();
      helpers.refreshOnboarding();
      helpers.refreshNav();
      if (!wasAuth && auth.state === 'authenticated') {
        if (state.streamingPending) {
          helpers.setStatus(
            '✔ Web API connected! Complete Step 2/2 in browser for audio playback.',
            true,
          );
          helpers.refreshOnboarding();
        } else {
          helpers.setStatus(
            `🎉 Authenticated as ${auth.accountId ?? 'user'}! Welcome to Spotoei.`,
            true,
          );
          helpers.showRoute('home', true, true);
          helpers.setNavSelected({ kind: 'home', tab: 'for_you' });
          helpers.setFocusArea('main');
        }
      }
      if (wasAuth && auth.state === 'unauthenticated') {
        helpers.showRoute('onboarding', true, true);
        helpers.setFocusArea('main');
      } else if (auth.state === 'refresh-failed') {
        helpers.setStatus('Session refresh failed; will retry', true);
      }
    },
    setStreamingPending(pending: boolean): void {
      const wasPending = state.streamingPending;
      state.streamingPending = pending;
      helpers.refreshOnboarding();
      if (wasPending && !pending && state.auth.state === 'authenticated') {
        helpers.showRoute('home', true, true);
        helpers.setNavSelected({ kind: 'home', tab: 'for_you' });
        helpers.setFocusArea('main');
      }
    },
  };
}
