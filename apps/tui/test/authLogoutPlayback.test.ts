import { describe, expect, it, mock } from 'bun:test';
import { createAuthActions } from '../src/main/auth';
import type { AppContext, AppState } from '../src/main/types';
import type { Ui } from '../src/ui/types';

describe('auth logout playback stop', () => {
  it('triggerLogout pauses playback, clears state and playback UI, and sets route to onboarding', async () => {
    let paused = false;
    let loggedOut = false;
    let playbackCleared = false;
    let routeSet = '';
    let statusSet = '';

    const mockClients = {
      playback: {
        pause: mock(async () => {
          paused = true;
        }),
      },
      auth: {
        logout: mock(async () => {
          loggedOut = true;
        }),
        setClientId: mock(async () => {}),
        initiate: mock(async () => ({ authUrl: 'http://example.com' })),
      },
      webApi: {
        pause: mock(async () => {}),
      },
    };

    const mockUi: Partial<Ui> = {
      setStatus: (msg: string) => {
        statusSet = msg;
      },
      setPlayback: (playback) => {
        if (playback === null) playbackCleared = true;
      },
      setRoute: (route) => {
        routeSet = typeof route === 'string' ? route : route.kind;
      },
      focusClientIdInput: () => {},
      setStreamingPending: () => {},
    };

    const mockState = {
      currentInfo: {
        auth: {
          v: 1,
          state: 'authenticated' as const,
          accountId: 'test-user',
          scopes: [],
          storage: 'keyring' as const,
          accessTokenExpiresAt: Date.now() + 3600000,
          authUrl: null,
        },
        playback: {
          state: 'playing' as const,
          track: null,
          positionMs: 1234,
          durationMs: 5000,
          volume: 1,
          shuffle: false,
          repeat: 'off' as const,
          device: null,
          revision: 1,
          reason: 'play',
        },
        queue: null,
        visualizer: null,
        audioConfig: null,
        streamingPending: false,
      },
      lastPlaybackState: 'playing',
      lastKnownPositionMs: 1234,
      lastPositionObservedAtMonotonicMs: 1000,
      recentTracks: [],
      favoriteTracks: [],
      trackPlayCounts: {},
      isPrivateSession: false,
      privateSessionRestoreState: null,
    } as unknown as AppState;

    const ctx = {
      clients: mockClients,
      getUi: () => mockUi as Ui,
      state: mockState,
    } as unknown as AppContext;

    const actions = createAuthActions(ctx);
    await actions.triggerLogout();

    expect(paused).toBe(true);
    expect(loggedOut).toBe(true);
    expect(playbackCleared).toBe(true);
    expect(mockState.currentInfo.playback).toBeNull();
    expect(mockState.lastPlaybackState).toBe('idle');
    expect(routeSet).toBe('onboarding');
    expect(statusSet).toContain('Logged out successfully');
  });
});
