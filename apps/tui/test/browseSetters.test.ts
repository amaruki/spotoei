import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';

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

const track = (id: string) => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Track ${id}`,
  artists: [{ name: 'Somebody' }],
  durationMs: 180000,
});

describe('browse setters on the real Ui', () => {
  it('setBrowseTracks renders rows instead of throwing (crash repro)', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    ui.setRoute({ kind: 'browse', path: { category: 'moods' } });
    expect(() => ui.setBrowseTracks([track('t1'), track('t2')])).not.toThrow();
    expect(() => ui.setBrowseTracks([])).not.toThrow();

    // Rows feed the context menu through the selected index.
    ui.setBrowseTracks([track('t1'), track('t2')]);
    const target = ui.getContextTarget();
    expect(target?.uri).toBe('spotify:track:t1');
    await ui.shutdown();
  });

  it('setBrowseBanner exists and clears without throwing', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    expect(() =>
      ui.setBrowseBanner('Browse live unavailable · using offline categories'),
    ).not.toThrow();
    expect(() => ui.setStatus('hello')).not.toThrow();
    expect(() => ui.setBrowseBanner(null)).not.toThrow();
    await ui.shutdown();
  });
});
