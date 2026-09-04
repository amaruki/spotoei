import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import { buildPlaybackBarContent } from '../src/ui/playbackBarView';

const baseState: UiViewState = {
  protocol: 1,
  playerVersion: '0.1.0',
  capabilities: ['audio'],
  auth: {
    v: PROTOCOL_VERSION,
    state: 'authenticated',
    accountId: 'u',
    scopes: [],
    storage: 'keyring',
    accessTokenExpiresAt: Date.now() + 3600_000,
    authUrl: null,
  },
  playback: null,
  queue: { current: null, upcoming: [], revision: 0 },
  visualizer: { mode: 'spectrum', fps: 30 },
};

describe('responsive layout', () => {
  it('migrates focus off the sidebar when it disappears below 80 cols', async () => {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setFocus('sidebar');
    expect(ui.getFocus()).toBe('sidebar');
    resize(70, 30);
    await renderOnce();
    expect(ui.getFocus()).toBe('main');
    await ui.shutdown();
  });

  it('sidebar toggle migrates focus at medium widths', async () => {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    resize(90, 40);
    await renderOnce();
    ui.setFocus('sidebar');
    ui.toggleSidebar();
    expect(ui.getFocus()).toBe('main');
    await ui.shutdown();
  });

  it('selects the bar tier from the renderer width', () => {
    const base = {
      state: 'playing' as const,
      title: 'T',
      artist: 'A',
      positionMs: 60000,
      durationMs: 180000,
      shuffle: false,
      repeat: 'off' as const,
      queueCount: 3,
      volume: 50,
    };
    expect(buildPlaybackBarContent({ ...base, width: 130 }).variant).toBe('wide');
    expect(buildPlaybackBarContent({ ...base, width: 100 }).variant).toBe('medium');
    expect(buildPlaybackBarContent({ ...base, width: 70 }).variant).toBe('narrow');
  });
});
