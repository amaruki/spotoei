import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type LibraryItemT, type UiViewState } from '../src/ui';
import { routeKind } from '../src/ui/core/navigationStack';

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

function makeUi() {
  return createTestRenderer({ width: 120, height: 40 }).then(({ renderer, renderOnce }) => {
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    return { ui, renderOnce };
  });
}

const track = (id: string): LibraryItemT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ name: 'A' }],
  durationMs: 1000,
});

describe('history positions and back behavior wiring', () => {
  it('restores list selection when navigating back', async () => {
    const { ui, renderOnce } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setSearchResults('q', {
      query: 'q',
      hits: [1, 2, 3].map((n) => ({
        type: 'track' as const,
        track: {
          id: `t${n}`,
          uri: `spotify:track:t${n}`,
          name: `T${n}`,
          artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
          durationMs: 1000,
        },
      })),
    });
    await renderOnce();

    ui.setRoute({ kind: 'album', id: 'alb1' });
    expect(routeKind(ui.getRoute())).toBe('album');
    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('search');
    await ui.shutdown();
  });

  it('back from a pushed route does not re-push (no forward loop)', async () => {
    const { ui, renderOnce } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setRoute({ kind: 'album', id: 'a1' });
    expect(ui.getRouteStack().length).toBe(2);
    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('search');
    expect(ui.getRouteStack().length).toBe(1);
    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });

  it('restores per-library-section positions independently', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    const sendKey = (name: string, sequence: string) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl: false,
        shift: false,
        meta: false,
      } as unknown as KeyEvent);
    };
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems([track('t1'), track('t2'), track('t3')]);
    await renderOnce();
    sendKey('down', '\u001b[B');
    sendKey('down', '\u001b[B');
    await renderOnce();

    ui.setRoute({ kind: 'library', section: 'playlists' });
    ui.setLibraryItems([track('p1'), track('p2')]);
    await renderOnce();

    expect(ui.navigateBack()).toBe(true);
    expect(ui.getRoute()).toEqual({ kind: 'library', section: 'saved_tracks' });
    // Async setLibraryItems re-applies the saved per-section position.
    ui.setLibraryItems([track('t1'), track('t2'), track('t3')]);
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't3' });
    await ui.shutdown();
  });

  it('browse levels step back one level per Esc via history', async () => {
    const { ui, renderOnce } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'home', tab: 'browse' });
    ui.setRoute({ kind: 'home', tab: 'browse', browse: { category: 'moods' } });
    ui.setRoute({ kind: 'home', tab: 'browse', browse: { category: 'moods', entry: 'chill' } });
    expect(ui.navigateBack()).toBe(true);
    expect(ui.getRoute()).toEqual({ kind: 'home', tab: 'browse', browse: { category: 'moods' } });
    expect(ui.navigateBack()).toBe(true);
    expect(ui.getRoute()).toEqual({ kind: 'home', tab: 'browse' });
    await ui.shutdown();
  });
});
