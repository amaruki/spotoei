import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';

function stateWith(auth: UiViewState['auth']): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio'],
    auth,
    playback: null,
    queue: { current: null, upcoming: [], revision: 0 },
    visualizer: { mode: 'spectrum', fps: 30 },
  };
}

const loggedOut = stateWith({
  v: PROTOCOL_VERSION,
  state: 'unauthenticated',
  accountId: null,
  scopes: [],
  storage: 'keyring',
  accessTokenExpiresAt: null,
  authUrl: null,
});

const loggedIn = stateWith({
  v: PROTOCOL_VERSION,
  state: 'authenticated',
  accountId: 'u',
  scopes: [],
  storage: 'keyring',
  accessTokenExpiresAt: Date.now() + 3600_000,
  authUrl: null,
});

describe('onboarding flow', () => {
  it('boots unauthenticated straight to onboarding with chrome hidden', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, loggedOut, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('onboarding');
    expect(ui.getRouteStack().length).toBe(0);
    await ui.shutdown();
  });

  it('Esc in onboarding stays on onboarding', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, loggedOut, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(ui.navigateBack()).toBe(false);
    expect(routeKind(ui.getRoute())).toBe('onboarding');
    await ui.shutdown();
  });

  it('auth success restores chrome and routes home', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, loggedOut, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setAuth(loggedIn.auth);
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });
});
