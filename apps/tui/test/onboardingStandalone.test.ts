import { describe, expect, it } from 'bun:test';
import type { UiViewState } from '../src/ui/types';
import { getSettingsContent } from '../src/ui/views/settings';
import { getNavOptions } from '../src/ui/views/nav';
import { shouldShowClientIdBox } from '../src/ui/views/onboarding';
import { buildPaletteCommands } from '../src/main/paletteCommands';
import type { AppContext } from '../src/main/types';

// The login flow lives on its own onboarding page. Settings must not host
// authentication: no login/logout actions, no Client ID management, and no
// "auth" wording in its navigation entries.

function authedState(): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['lyrics.synced'],
    auth: {
      v: 1,
      state: 'authenticated',
      accountId: 'test-user',
      storage: 'keyring',
      scopes: [],
      accessTokenExpiresAt: null,
      authUrl: null,
    },
    playback: null,
    queue: { current: null, upcoming: [], revision: 0 },
    visualizer: { mode: 'off', fps: 30 },
    audioConfig: {
      deviceMode: 'integrated',
      audioBackend: 'rodio',
      bitrate: '320',
      crossfadeDurationMs: 0,
      normalisation: true,
      pregain: 0,
    },
  };
}

const viewText = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

describe('standalone onboarding page', () => {
  it('keeps authentication out of the settings view', () => {
    const text = viewText(getSettingsContent(authedState()));
    expect(text).toContain('Audio Engine & Librespot');
    expect(text).not.toMatch(/log out/i);
    expect(text).not.toMatch(/re-authenticate/i);
    expect(text).not.toMatch(/client id/i);
    expect(text).not.toMatch(/redirect uri/i);
  });

  it('points logged-out settings visitors at the onboarding flow', () => {
    const loggedOut: UiViewState = {
      ...authedState(),
      auth: { ...authedState().auth, state: 'unauthenticated', accountId: null },
    };
    expect(viewText(getSettingsContent(loggedOut))).toMatch(/onboarding/i);
  });

  it('shows the Client ID editor only on the client-id step', () => {
    expect(shouldShowClientIdBox('client-id')).toBe(true);
    expect(shouldShowClientIdBox('authenticate')).toBe(false);
    expect(shouldShowClientIdBox('authenticating')).toBe(false);
  });

  it('labels settings navigation without auth wording', () => {
    for (const authed of [false, true]) {
      const settings = getNavOptions(authed).find((o) => o.value === 'settings');
      expect(settings).toBeDefined();
      expect(`${settings?.name} ${settings?.description}`).not.toMatch(/auth/i);
    }
  });

  it('offers a palette command that opens the standalone login page', async () => {
    let route: unknown = null;
    const ctx = {
      clients: {},
      state: { currentInfo: authedState() },
      getUi: () => null,
    } as unknown as AppContext;
    const cmds = buildPaletteCommands(
      ctx,
      {} as unknown as Parameters<typeof buildPaletteCommands>[1],
      () => ({ setRoute: (r: unknown) => void (route = r) }) as never,
      async () => {},
    );
    const loginPage = cmds.find((c) => /login page/i.test(c.name));
    expect(loginPage).toBeDefined();
    loginPage!.action();
    expect(route).toEqual('onboarding');
  });
});
