import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import {
  PROTOCOL_VERSION,
  type AuthCompletedEventDataT,
  type AuthFailedEventDataT,
  type AuthStatusDataT,
} from 'spotoei-protocol';
import { routeKind } from '../src/ui/core/navigationStack';

import { createAuthActions } from '../src/main/auth';
import { wireSubscriptions } from '../src/main/listeners';
import type { AppContext } from '../src/main/types';
import { createUiCore, type Ui, type UiViewState } from '../src/ui';

const openedUrls: string[] = [];
let browserWillOpen = true;
mock.module('../src/system', () => ({
  openBrowser: (url: string) => {
    openedUrls.push(url);
    return browserWillOpen;
  },
  copyToClipboard: () => true,
}));

function view(authState: AuthStatusDataT['state']): UiViewState {
  return {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio'],
    auth: {
      v: PROTOCOL_VERSION,
      state: authState,
      accountId: authState === 'authenticated' ? 'tester' : null,
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

function authClients(overrides: Record<string, unknown> = {}) {
  return {
    visualizer: { subscribe: () => {} },
    auth: {
      onStatusChange: () => {},
      status: async () => view('unauthenticated').auth,
      begin: async () => view('authenticating').auth,
      beginStreaming: async () => view('authenticating').auth,
      streamingStatus: async () => false,
      ...overrides,
    },
    playback: { onChange: () => {}, onPosition: () => {}, pause: async () => {} },
    queueManager: { subscribe: () => {} },
    lyrics: { subscribe: () => {} },
    webApi: {},
    ...({} as Record<string, unknown>),
  };
}

const baseActions = {
  triggerAuth: () => Promise.resolve(),
  loadLibrary: () => Promise.resolve(),
  loadCurrentLyrics: () => Promise.resolve(),
  updateQueueView: () => Promise.resolve(),
  ensureAutoplayTracks: () => Promise.resolve(),
  playTrackOrContext: () => Promise.resolve(),
  nextTrack: () => Promise.resolve(),
};

describe('pending login flow', () => {
  beforeEach(() => {
    browserWillOpen = true;
  });

  test('pressing a while a login is pending re-opens it instead of starting over', async () => {
    openedUrls.length = 0;
    let begins = 0;
    let streamingBegins = 0;
    const ctx = {
      clients: authClients({
        status: async () => ({
          ...view('authenticating').auth,
          authUrl: 'http://127.0.0.1:8989/login?pending=1',
        }),
        begin: async () => {
          begins++;
          return view('authenticating').auth;
        },
        beginStreaming: async () => {
          streamingBegins++;
          return view('authenticating').auth;
        },
      }),
      state: { currentInfo: view('authenticating'), lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;
    await createAuthActions(ctx).triggerAuth();
    expect(begins).toBe(0);
    expect(streamingBegins).toBe(0);
    expect(openedUrls).toEqual(['http://127.0.0.1:8989/login?pending=1']);
  });

  test('a backend login failure is shown instead of failing silently', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const currentInfo = view('authenticating');
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    let calls = 0;
    const ctx = {
      clients: authClients({
        onAuthFailure: (l: (f: AuthFailedEventDataT) => void) => {
          calls++;
          l({ reason: 'token_exchange', message: 'bad verifier' });
        },
      }),
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);
    expect(calls).toBe(1);
    await renderOnce();
    expect(currentInfo.statusMessage ?? '').toMatch(/login failed/i);
    await ui.shutdown();
  });

  test('a completed streaming login clears the pending flag', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    let calls = 0;
    const ctx = {
      clients: authClients({
        onAuthCompleted: (l: (c: AuthCompletedEventDataT) => void) => {
          calls++;
          l({ accountId: 'tester', scopes: [], streaming: true });
        },
      }),
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);
    expect(calls).toBe(1);
    expect(currentInfo.streamingPending).toBe(false);
    await ui.shutdown();
  });

  test('an authenticated status with streaming credentials recovers a missed completion event', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    let statusListener: ((status: AuthStatusDataT) => void) | null = null;
    const ctx = {
      clients: authClients({
        onStatusChange: (listener: (status: AuthStatusDataT) => void) => {
          statusListener = listener;
        },
        streamingStatus: async () => true,
      }),
      state: {
        currentInfo,
        hasStreaming: false,
        lastPlaybackState: 'idle',
      },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);

    statusListener!(view('authenticated').auth);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.state.hasStreaming).toBe(true);
    expect(currentInfo.streamingPending).toBe(false);
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });

  test('a web login completion keeps onboarding pending while Step 2 starts', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    const ctx = {
      clients: authClients({
        onAuthCompleted: (l: (c: AuthCompletedEventDataT) => void) => {
          l({ accountId: 'tester', scopes: [] });
        },
      }),
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(currentInfo.streamingPending).toBe(true);
    await ui.shutdown();
  });

  test('concurrent triggers mint a single login flow', async () => {
    openedUrls.length = 0;
    let streamingBegins = 0;
    const ctx = {
      clients: authClients({
        status: async () => view('authenticated').auth,
        streamingStatus: async () => false,
        beginStreaming: async () => {
          streamingBegins++;
          await new Promise((r) => setTimeout(r, 20));
          return { ...view('authenticating').auth, authUrl: 'http://127.0.0.1:8989/login?x=1' };
        },
      }),
      state: { currentInfo: view('authenticated'), lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;
    const { triggerAuth } = createAuthActions(ctx);
    await Promise.all([triggerAuth(), triggerAuth()]);
    expect(streamingBegins).toBe(1);
  });

  test('a browser launcher failure exposes the authorization URL in the TUI', async () => {
    browserWillOpen = false;
    const messages: string[] = [];
    const ctx = {
      clients: authClients({
        status: async () => view('unauthenticated').auth,
        begin: async () => ({
          ...view('authenticating').auth,
          authUrl: 'http://127.0.0.1:8989/login?state=visible',
        }),
      }),
      state: { currentInfo: view('unauthenticated'), lastPlaybackState: 'idle' },
      getUi: () => ({
        setStatus: (message: string) => messages.push(message),
        focusClientIdInput: () => {},
        setStreamingPending: () => {},
      }),
    } as unknown as AppContext;

    await createAuthActions(ctx).triggerAuth();

    expect(messages.at(-1)).toContain('http://127.0.0.1:8989/login?state=visible');
  });

  test('a cached Web login opens the missing desktop approval automatically', async () => {
    openedUrls.length = 0;
    let streamingBegins = 0;
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    const ctx = {
      clients: authClients({
        status: async () => currentInfo.auth,
        beginStreaming: async () => {
          streamingBegins++;
          return {
            ...view('authenticating').auth,
            authUrl: 'http://127.0.0.1:8989/login?state=desktop',
          };
        },
      }),
      state: {
        currentInfo,
        hasStreaming: false,
        lastPlaybackState: 'idle',
      },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;

    await createAuthActions(ctx).triggerAuth({ streamingOnly: true });

    expect(streamingBegins).toBe(1);
    expect(openedUrls).toEqual(['http://127.0.0.1:8989/login?state=desktop']);
  });

  test('a fresh web login routes audio permission through the single trigger', async () => {
    let triggers = 0;
    let directStreamingBegins = 0;
    let authListener: ((next: AuthStatusDataT) => void) | null = null;
    let authCompletedListener: ((completed: AuthCompletedEventDataT) => void) | null = null;
    const authed = view('authenticated');
    const ctx = {
      clients: authClients({
        onStatusChange: (l: (next: AuthStatusDataT) => void) => {
          authListener = l;
        },
        onAuthCompleted: (l: (completed: AuthCompletedEventDataT) => void) => {
          authCompletedListener = l;
        },
        beginStreaming: async () => {
          directStreamingBegins++;
          return view('authenticating').auth;
        },
        webApi: { getDevices: async () => [] },
      }),
      state: { currentInfo: view('unauthenticated'), lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;
    const fireStatus = (next: AuthStatusDataT) => {
      if (!authListener) throw new Error('status listener not registered');
      (authListener as (next: AuthStatusDataT) => void)(next);
    };
    wireSubscriptions(
      ctx,
      {
        ...baseActions,
        triggerAuth: () => {
          triggers++;
          return Promise.resolve();
        },
      },
      { enrichPlaybackTrack: (x: never) => x } as never,
    );
    fireStatus(authed.auth);
    await new Promise((r) => setTimeout(r, 50));
    expect(triggers).toBe(0);
    authCompletedListener!({ accountId: 'tester', scopes: [], streaming: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(triggers).toBe(1);
    expect(directStreamingBegins).toBe(0);
  });

  test('logout clears a stale streaming-pending flag', async () => {
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    let logouts = 0;
    const ctx = {
      clients: authClients({
        logout: async () => {
          logouts++;
          return view('unauthenticated').auth;
        },
      }),
      state: { currentInfo, hasStreaming: true, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;

    await createAuthActions(ctx).triggerLogout();

    expect(logouts).toBe(1);
    expect(currentInfo.streamingPending).toBe(false);
    expect(ctx.state.hasStreaming).toBe(false);
  });

  test('an unauthenticated status clears the stale streaming-pending flag', async () => {
    const currentInfo = view('authenticated');
    currentInfo.streamingPending = true;
    let statusListener: ((status: AuthStatusDataT) => void) | null = null;
    const ctx = {
      clients: authClients({
        onStatusChange: (listener: (status: AuthStatusDataT) => void) => {
          statusListener = listener;
        },
      }),
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);

    statusListener!(view('unauthenticated').auth);

    expect(currentInfo.streamingPending).toBe(false);
  });

  test('a player-reported pending flow is reopened without a local pending flag', async () => {
    openedUrls.length = 0;
    let streamingBegins = 0;
    const ctx = {
      clients: authClients({
        status: async () => ({
          ...view('authenticated').auth,
          authUrl: 'http://127.0.0.1:8989/login?state=pending',
          pending: true,
        }),
        beginStreaming: async () => {
          streamingBegins++;
          return view('authenticating').auth;
        },
      }),
      state: { currentInfo: view('authenticated'), hasStreaming: true, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => null,
    } as unknown as AppContext;

    await createAuthActions(ctx).triggerAuth();

    expect(streamingBegins).toBe(0);
    expect(openedUrls).toEqual(['http://127.0.0.1:8989/login?state=pending']);
  });

  test('setAuth keeps user on onboarding while streamingPending is true, and onAuthCompleted routes home', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const currentInfo = view('unauthenticated');
    const ui = createUiCore(renderer, currentInfo, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('onboarding');

    ui.setStreamingPending(true);
    ui.setAuth({
      v: PROTOCOL_VERSION,
      state: 'authenticated',
      accountId: 'tester',
      storage: 'keyring',
      scopes: [],
      accessTokenExpiresAt: null,
      authUrl: null,
    });
    expect(routeKind(ui.getRoute())).toBe('onboarding');

    let completeCb: ((c: AuthCompletedEventDataT) => void) | null = null;
    const ctx = {
      clients: authClients({
        onAuthCompleted: (l: (c: AuthCompletedEventDataT) => void) => {
          completeCb = l;
        },
      }),
      state: { currentInfo, lastPlaybackState: 'idle' },
      getUi: (): Ui | null => ui,
    } as unknown as AppContext;
    wireSubscriptions(ctx, baseActions, { enrichPlaybackTrack: (x: never) => x } as never);

    completeCb!({ accountId: 'tester', scopes: [], streaming: true });
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });
});
