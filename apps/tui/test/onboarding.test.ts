import { afterEach, describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';
import { onboardingStep } from '../src/ui/views/onboarding';

function stateWith(authState: 'unauthenticated' | 'authenticating' | 'authenticated'): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio'],
    auth: {
      v: PROTOCOL_VERSION,
      state: authState,
      accountId: authState === 'authenticated' ? 'u' : null,
      scopes: [],
      storage: 'keyring',
      accessTokenExpiresAt: null,
      authUrl: null,
    },
    playback: null,
    queue: { current: null, upcoming: [], revision: 0 },
    visualizer: { mode: 'spectrum', fps: 30 },
  };
}

describe('onboarding steps', () => {
  const savedEnv = process.env.SPOTOEI_CLIENT_ID;
  const savedDir = process.env.SPOTOEI_CONFIG_DIR;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SPOTOEI_CLIENT_ID;
    else process.env.SPOTOEI_CLIENT_ID = savedEnv;
    if (savedDir === undefined) delete process.env.SPOTOEI_CONFIG_DIR;
    else process.env.SPOTOEI_CONFIG_DIR = savedDir;
  });

  it('shows client-id step by default when no client ID configured', () => {
    delete process.env.SPOTOEI_CLIENT_ID;
    process.env.SPOTOEI_CONFIG_DIR = '/tmp/spotoei-onboarding-test-empty';
    expect(onboardingStep(stateWith('unauthenticated'))).toBe('client-id');
  });

  it('shows authenticate step once Client ID exists', () => {
    process.env.SPOTOEI_CLIENT_ID = 'test-client-id';
    expect(onboardingStep(stateWith('unauthenticated'))).toBe('authenticate');
  });

  it('shows authenticating step while browser flow is pending', () => {
    process.env.SPOTOEI_CLIENT_ID = 'test-client-id';
    expect(onboardingStep(stateWith('authenticating'))).toBe('authenticating');
  });
});

describe('onboarding hero and page isolation', () => {
  it('renders block ASCII hero and hides all app chrome when logged out', async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 120,
      height: 40,
    });
    const ui = createUiCore(renderer, stateWith('unauthenticated'), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('onboarding');
    const frame = captureCharFrame();
    expect(frame).toContain('███████╗');
    expect(frame).not.toContain('Navigation');
    expect(frame).not.toContain('Playback');
    await ui.shutdown();
  });

  it('renders compact hero without clipping on narrow terminals', async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 70,
      height: 40,
    });
    const ui = createUiCore(renderer, stateWith('unauthenticated'), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).not.toContain('███████╗');
    expect(frame).toContain('█');
    expect(frame).not.toContain('Navigation');
    await ui.shutdown();
  });
});

describe('onboarding route flow', () => {
  it('logout returns to onboarding, login routes home', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, stateWith('authenticated'), {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('home');

    ui.setAuth(stateWith('unauthenticated').auth);
    expect(routeKind(ui.getRoute())).toBe('onboarding');

    ui.setAuth(stateWith('authenticated').auth);
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });
});
