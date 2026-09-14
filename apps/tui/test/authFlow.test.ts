import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION, type AuthStatusDataT } from 'spotoei-protocol';
import { wireSubscriptions } from '../src/main/listeners';
import type { AppContext } from '../src/main/types';
import { createUiCore, type Ui, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';

function unauthView(): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio'],
    auth: {
      v: PROTOCOL_VERSION,
      state: 'unauthenticated',
      accountId: null,
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

function authedStatus(): AuthStatusDataT {
  return {
    v: PROTOCOL_VERSION,
    state: 'authenticated',
    accountId: 'tester',
    scopes: [],
    storage: 'keyring',
    accessTokenExpiresAt: Date.now() + 3600_000,
    authUrl: null,
  };
}

describe('auth changed subscription', () => {
  it('routes to home on login success without pre-mutating shared state', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    // Same object shared by reference between main state and the UI,
    // exactly like production initUi.
    const currentInfo = unauthView();
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('onboarding');

    let authListener: ((next: AuthStatusDataT) => void) | null = null;
    let authCompletedListener: ((c: { streaming?: boolean }) => void) | null = null;
    const ctx = {
      clients: {
        visualizer: { subscribe: () => {} },
        auth: {
          onStatusChange: (l: (next: AuthStatusDataT) => void) => {
            authListener = l;
          },
          onAuthCompleted: (l: (c: { streaming?: boolean }) => void) => {
            authCompletedListener = l;
          },
        },
        playback: { onChange: () => {}, onPosition: () => {} },
        queueManager: { subscribe: () => {} },
        lyrics: { subscribe: () => {} },
      },
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(
      ctx,
      {
        triggerAuth: () => Promise.resolve(),
        loadLibrary: () => Promise.resolve(),
        loadCurrentLyrics: () => Promise.resolve(),
        updateQueueView: () => Promise.resolve(),
        ensureAutoplayTracks: () => Promise.resolve(),
        playTrackOrContext: () => Promise.resolve(),
        nextTrack: () => Promise.resolve(),
      },
      { enrichPlaybackTrack: (x: never) => x } as never,
    );

    const listener: (next: AuthStatusDataT) => void = authListener ?? (() => {});
    const completedListener: (c: { streaming?: boolean }) => void =
      authCompletedListener ?? (() => {});
    expect(authListener).not.toBeNull();
    listener(authedStatus());
    expect(currentInfo.streamingPending).toBe(true);
    completedListener({ streaming: true });
    expect(routeKind(ui.getRoute())).toBe('home');
    expect(currentInfo.auth.state).toBe('authenticated');
    await ui.shutdown();
  });
});
