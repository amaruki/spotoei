import { describe, expect, it, vi } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type LibraryItemT, type Route, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';

const kindOf = (r: Route): string => routeKind(r);

describe('OpenTUI renderables integration', () => {
  const dummyState: UiViewState = {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio', 'visualizer'],
    auth: {
      v: PROTOCOL_VERSION,
      state: 'authenticated',
      accountId: 'test-user',
      scopes: ['user-read-playback-state'],
      storage: 'keyring',
      accessTokenExpiresAt: Date.now() + 3600_000,
      authUrl: null,
    },
    playback: {
      revision: 1,
      observedAtMonotonicMs: 1000,
      state: 'playing',
      track: {
        uri: 'spotify:track:123',
        name: 'Test Track',
        artists: ['Test Artist'],
        album: 'Test Album',
        durationMs: 180000,
      },
      positionMs: 45000,
      durationMs: 180000,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
      autoplay: false,
    },
    queue: {
      current: {
        id: '123',
        uri: 'spotify:track:123',
        name: 'Test Track',
        artists: [{ id: 'a1', name: 'Test Artist', uri: 'spotify:artist:a1' }],
        albumName: 'Test Album',
        durationMs: 180000,
      },
      upcoming: [
        {
          id: 'q1',
          source: 'context',
          addedAt: Date.now(),
          track: {
            id: '456',
            uri: 'spotify:track:456',
            name: 'Next Track',
            artists: [{ id: 'a2', name: 'Another Artist', uri: 'spotify:artist:a2' }],
            albumName: 'Next Album',
            durationMs: 200000,
          },
        },
      ],
      revision: 1,
    },
    visualizer: { mode: 'spectrum', fps: 30 },
  };

  it('builds renderable tree and mounts to root without error', async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 120,
      height: 40,
    });

    const keyEvents: string[] = [];
    let savedClientId = '';
    const ui = createUiCore(renderer, dummyState, {
      onKey: (k) => {
        keyEvents.push(k.name);
      },
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
      onSaveClientId: (id) => {
        savedClientId = id;
      },
    });

    expect(renderer.root.getChildren().length).toBeGreaterThan(0);

    // Initial render
    await renderOnce();

    // Verify route switching
    ui.setRoute({ kind: 'search' });
    expect(kindOf(ui.getRoute())).toBe('search');
    await renderOnce();

    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    expect(kindOf(ui.getRoute())).toBe('library');
    await renderOnce();

    ui.setRoute({ kind: 'queue' });
    expect(kindOf(ui.getRoute())).toBe('queue');
    await renderOnce();

    ui.setRoute({ kind: 'lyrics' });
    expect(kindOf(ui.getRoute())).toBe('lyrics');
    await renderOnce();
    // Verify search results rendering
    ui.setSearchResults('test', {
      query: 'test',
      hits: [
        {
          type: 'track',
          track: {
            id: 'hit1',
            uri: 'spotify:track:hit1',
            name: 'Search Hit Track',
            artists: [{ id: 'ha1', name: 'Hit Artist', uri: 'spotify:artist:ha1' }],
            albumName: 'Hit Album',
            durationMs: 150000,
            isExplicit: false,
            isPlayable: true,
          },
        },
      ],
    });
    await renderOnce();

    // Verify queue snapshot rendering
    ui.setQueueSnapshot({
      current: {
        id: '123',
        uri: 'spotify:track:123',
        name: 'Playing Track',
        artists: [{ id: 'a1', name: 'Artist A', uri: 'spotify:artist:a1' }],
        albumName: 'Album A',
        durationMs: 180000,
      },
      upcoming: [
        {
          id: 'q2',
          source: 'context',
          addedAt: Date.now(),
          track: {
            id: '789',
            uri: 'spotify:track:789',
            name: 'Queued Track 1',
            artists: [{ id: 'b1', name: 'Artist B', uri: 'spotify:artist:b1' }],
            albumName: 'Album B',
            durationMs: 210000,
          },
        },
      ],
      revision: 2,
    });
    await renderOnce();

    // Verify lyrics rendering
    ui.setLyrics({
      kind: 'synced',
      lines: [
        { startMs: 1000, text: 'First line of song' },
        { startMs: 5000, text: 'Second line of song' },
      ],
    });
    await renderOnce();

    // Verify spectrum visualizer frame rendering
    ui.setVisualizerFrame({
      mode: 'spectrum',
      data: [0.1, 0.5, 0.8, 0.3, 0.9, 0.2, 0.6, 0.4],
    });
    await renderOnce();

    // Verify oscilloscope visualizer frame rendering
    ui.setVisualizerFrame({
      mode: 'oscilloscope',
      data: [0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5],
    });
    await renderOnce();

    // Verify status message
    ui.setStatus('Test status message');
    await renderOnce();

    // Helper to simulate keypress events
    const sendKey = (name: string, sequence: string, ctrl = false) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl,
        shift: false,
        meta: false,
      } as unknown as KeyEvent);
    };

    // Verify command palette execution
    let executedCmd = '';
    ui.setPaletteCommands([
      {
        name: 'Command Alpha',
        description: 'desc1',
        action: () => {
          executedCmd = 'alpha';
        },
      },
      {
        name: 'Command Beta',
        description: 'desc2',
        action: () => {
          executedCmd = 'beta';
        },
      },
    ]);
    ui.openPalette();
    expect(ui.isPaletteOpen()).toBe(true);
    // Down arrow to select Command Beta
    sendKey('down', '\u001b[B');
    // Press return to execute
    sendKey('return', '\r');
    expect(ui.isPaletteOpen()).toBe(false);
    expect(executedCmd).toBe('beta');

    ui.setRoute({ kind: 'search' });
    keyEvents.length = 0;
    sendKey('q', 'q');
    sendKey('r', 'r');
    sendKey('k', 'k');
    sendKey('space', ' ');
    expect(keyEvents.length).toBe(0); // Typing must not trigger global shortcuts!
    // Verify quick numeric shortcuts for navigation
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    expect(kindOf(ui.getRoute())).toBe('home');
    vi.useFakeTimers();
    sendKey('2', '2');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('browse');
    sendKey('4', '4');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('library');
    sendKey('5', '5');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('queue');
    sendKey('6', '6');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('lyrics');
    sendKey('7', '7');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('settings');
    sendKey('1', '1');
    vi.advanceTimersByTime(1000);
    expect(kindOf(ui.getRoute())).toBe('home');
    vi.useRealTimers();

    // Verify sidebar focus toggle with Tab
    ui.setFocus('sidebar');
    sendKey('down', '\u001b[B');
    sendKey('tab', '\t');

    // Verify focusClientIdInput routes to onboarding and focuses input
    ui.focusClientIdInput();
    expect(kindOf(ui.getRoute())).toBe('onboarding');

    // Verify sidebar focus toggle with Tab
    ui.setFocus('sidebar');
    sendKey('down', '\u001b[B');
    sendKey('tab', '\t');

    // Verify focusClientIdInput and client ID typing & saving
    ui.focusClientIdInput();
    expect(kindOf(ui.getRoute())).toBe('onboarding');
    keyEvents.length = 0;
    sendKey('q', 'q');
    sendKey('c', 'c');
    expect(keyEvents.length).toBe(0); // input consumes keystrokes
    // Press return to save
    sendKey('return', '\r');
    expect(typeof savedClientId).toBe('string');

    await ui.shutdown();
  });

  it('enforces onboarding setup and authentication gate for unauthenticated users', async () => {
    process.env.SPOTOEI_CLIENT_ID = 'test-client-id';
    const { renderer, renderOnce } = await createTestRenderer({
      width: 120,
      height: 40,
    });
    let authTriggered = false;
    const unauthState: UiViewState = {
      ...dummyState,
      auth: {
        v: PROTOCOL_VERSION,
        state: 'unauthenticated',
        accountId: null,
        scopes: [],
        storage: 'keyring',
        accessTokenExpiresAt: null,
        authUrl: null,
      },
    };

    const ui = createUiCore(renderer, unauthState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
      onAuthenticate: () => {
        authTriggered = true;
      },
    });

    await renderOnce();

    // 1. Initial route for unauthenticated users must be onboarding
    expect(kindOf(ui.getRoute())).toBe('onboarding');

    // 2. Pressing 'a' in onboarding triggers authentication
    renderer.keyInput.emit('keypress', {
      name: 'a',
      sequence: 'a',
      ctrl: false,
      shift: false,
      meta: false,
    } as unknown as KeyEvent);
    expect(authTriggered).toBe(true);
    // 4. Authenticating unlocks all routes and transitions to home
    ui.setAuth({
      v: PROTOCOL_VERSION,
      state: 'authenticated',
      accountId: 'spotify-tester',
      scopes: ['user-read-playback-state'],
      storage: 'keyring',
      accessTokenExpiresAt: Date.now() + 3600000,
      authUrl: null,
    });

    expect(kindOf(ui.getRoute())).toBe('home');

    // 5. Now player views can be accessed freely
    ui.setRoute({ kind: 'search' });
    expect(kindOf(ui.getRoute())).toBe('search');
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    expect(kindOf(ui.getRoute())).toBe('library');
    await ui.shutdown();
    delete process.env.SPOTOEI_CLIENT_ID;
  });

  it('navigation only activates on Enter, search submits strictly on Enter, and focus toggles correctly', async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 120,
      height: 40,
    });

    const submittedSearches: string[] = [];
    const globalKeys: string[] = [];

    const ui = createUiCore(renderer, dummyState, {
      onKey: (k) => {
        globalKeys.push(k.name);
      },
      onSearchSubmit: (q) => {
        submittedSearches.push(q);
      },
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });

    await renderOnce();

    const sendKey = (name: string, sequence: string, ctrl = false) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl,
        shift: false,
        meta: false,
      } as unknown as KeyEvent);
    };

    // 1. Initial focus is sidebar and route is home
    expect(kindOf(ui.getRoute())).toBe('home');
    expect(ui.getFocus()).toBe('sidebar');

    // 2. Moving Up/Down in navigation must NOT auto-switch the route!
    sendKey('down', '\u001b[B');
    await renderOnce();
    // Route must remain 'home' even though cursor moved down in sidebar select
    expect(kindOf(ui.getRoute())).toBe('home');
    expect(ui.getFocus()).toBe('sidebar');

    // 2b. One step down lands on Browse (sidebar order: Home, Browse, Search, …)
    sendKey('return', '\r');
    await renderOnce();
    expect(kindOf(ui.getRoute())).toBe('browse');
    expect(ui.getFocus()).toBe('main');

    // 3. One step down from Browse + Enter confirms 'search'. The render
    // pass after setFocus matters: focus changes apply on the next frame.
    ui.setFocus('sidebar');
    await renderOnce();
    sendKey('down', '\u001b[B');
    sendKey('return', '\r');
    await renderOnce();
    expect(kindOf(ui.getRoute())).toBe('search');
    expect(ui.getFocus()).toBe('main');

    // 4. In search, typing characters are consumed by searchInput (no search submit yet)
    sendKey('c', 'c');
    sendKey('o', 'o');
    sendKey('l', 'l');
    sendKey('d', 'd');
    expect(submittedSearches.length).toBe(0);
    expect(globalKeys.length).toBe(0); // global hotkeys like 'l' must NOT trigger!

    // 5. Pressing Enter strictly submits the query
    sendKey('return', '\r');
    expect(submittedSearches).toEqual(['cold']);

    // 6. Pressing Escape pops navigation (FSD 8.4) or returns focus
    sendKey('escape', '\u001b');
    await renderOnce();
    expect(ui.getFocus()).toBe('main');
    // 7. Pressing Tab on Home cycles panels, staying in main
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    await renderOnce();
    sendKey('tab', '\t');
    await renderOnce();
    expect(ui.getFocus()).toBe('main');
    await ui.shutdown();
  });

  it('library items are populated, route change is notified, and selecting an item triggers playback', async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 120,
      height: 40,
    });

    const routeChanges: Route[] = [];
    const selectedItems: LibraryItemT[] = [];
    const selectedIndices: number[] = [];

    const ui = createUiCore(renderer, dummyState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: (idx) => {
        selectedIndices.push(idx);
      },
      onSelectLibraryItem: (item) => {
        selectedItems.push(item);
      },
      onSelectQueue: () => {},
      onRouteChange: (r: Route) => {
        routeChanges.push(r);
      },
    });

    await renderOnce();

    const sendKey = (name: string, sequence: string, ctrl = false) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl,
        shift: false,
        meta: false,
      } as unknown as KeyEvent);
    };

    // 1. Switch to library route
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    await renderOnce();
    const mockTracks: LibraryItemT[] = [
      {
        id: 'track-1',
        uri: 'spotify:track:track-1',
        name: 'Creep',
        artists: [{ id: 'a1', name: 'Radiohead', uri: 'spotify:artist:a1' }],
        albumName: 'Pablo Honey',
        durationMs: 238000,
      },
      {
        id: 'track-2',
        uri: 'spotify:track:track-2',
        name: 'Karma Police',
        artists: [{ id: 'a1', name: 'Radiohead', uri: 'spotify:artist:a1' }],
        albumName: 'OK Computer',
        durationMs: 261000,
      },
    ];

    ui.setLibraryItems(mockTracks);
    await renderOnce();

    // 3. Pressing Enter on first item triggers onSelectLibraryItem with full track info
    sendKey('return', '\r');
    expect(selectedIndices).toEqual([0]);
    expect(selectedItems.length).toBe(1);
    expect(selectedItems[0]?.name).toBe('Creep');
    expect(selectedItems[0]?.uri).toBe('spotify:track:track-1');

    await ui.shutdown();
  });

  it('visualizer visibility toggles and hotkeys dispatch properly', async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 120,
      height: 40,
    });
    const receivedKeys: Array<{ name: string; sequence: string; shift?: boolean }> = [];

    const ui = createUiCore(renderer, dummyState, {
      onKey: (k) => {
        receivedKeys.push(k);
      },
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });

    await renderOnce();

    // 1. Visualizer is a fullscreen route, not a side panel: it starts closed
    expect(routeKind(ui.getRoute())).not.toBe('visualizer');

    // 2. Route to the visualizer and back restores the prior route
    ui.setRoute({ kind: 'visualizer' });
    expect(routeKind(ui.getRoute())).toBe('visualizer');
    await renderOnce();
    ui.setVisualizerFrame({ mode: 'spectrum', data: [0.2, 0.6, 0.4] });
    await renderOnce();
    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('home');

    // 3. Dispatch shifted keys (S, R, A, V) and u from sidebar focus,
    // where they fall through to the global onKey handler
    ui.setFocus('sidebar');
    const sendKey = (name: string, sequence: string, shift = false) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl: false,
        shift,
        meta: false,
      } as unknown as KeyEvent);
    };

    sendKey('s', 'S', true);
    sendKey('r', 'R', true);
    sendKey('a', 'A', true);
    sendKey('v', 'V', true);
    sendKey('u', 'u', false);

    expect(receivedKeys.length).toBe(5);
    expect(receivedKeys[0]?.sequence).toBe('S');
    expect(receivedKeys[1]?.sequence).toBe('R');
    expect(receivedKeys[2]?.sequence).toBe('A');
    expect(receivedKeys[3]?.sequence).toBe('V');
    expect(receivedKeys[4]?.name).toBe('u');

    await ui.shutdown();
  });
});
