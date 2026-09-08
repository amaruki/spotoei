import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';

function authWith(state: UiViewState['auth']['state'], accountId: string | null = null): UiViewState['auth'] {
  return {
    v: PROTOCOL_VERSION,
    state,
    accountId,
    scopes: [],
    storage: 'keyring',
    accessTokenExpiresAt: state === 'authenticated' ? Date.now() + 3600_000 : null,
    authUrl: null,
  };
}

function stateWith(auth: UiViewState['auth']): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio'],
    auth: { ...auth },
    playback: null,
    queue: { current: null, upcoming: [], revision: 0 },
    visualizer: { mode: 'spectrum', fps: 30 },
  };
}

const loggedOutAuth = authWith('unauthenticated');
const loggedOut = stateWith(loggedOutAuth);

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
    // Sidebar and playback bar hidden when unauthenticated
    const ctx = (ui as unknown as { ctx?: { built: { sidebar: { visible: boolean }; playbackBar: { visible: boolean } } } }).ctx;
    if (ctx) {
      expect(ctx.built.sidebar.visible).toBe(false);
      expect(ctx.built.playbackBar.visible).toBe(false);
    }
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
    const ui = createUiCore(renderer, stateWith(authWith('unauthenticated')), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setAuth(authWith('authenticated', 'u'));
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });

  it('navigates to onboarding (Account) when authenticated and selects it in nav', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, stateWith(authWith('authenticated', 'u')), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('home');

    ui.setRoute('onboarding');
    expect(routeKind(ui.getRoute())).toBe('onboarding');
    await ui.shutdown();
  });

  it('setAuth transition from authenticated to unauthenticated hides chrome and routes to onboarding', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, stateWith(authWith('authenticated', 'u')), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('home');
    ui.setAuth(authWith('unauthenticated'));
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('onboarding');
    await ui.shutdown();
  });
});
