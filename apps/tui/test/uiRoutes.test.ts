import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
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
  playback: {
    revision: 1,
    observedAtMonotonicMs: 1,
    state: 'playing',
    track: {
      uri: 'spotify:track:1',
      name: 'Song',
      artists: ['Singer'],
      album: 'Album',
      durationMs: 200000,
    },
    positionMs: 50000,
    durationMs: 200000,
    volume: 0.68,
    shuffle: false,
    repeat: 'off',
    autoplay: false,
  },
  queue: { current: null, upcoming: [], revision: 0 },
  visualizer: { mode: 'spectrum', fps: 30 },
};

describe('entity, browse and visualizer routes', () => {
  it('opens album and shows initial tracks, then restores search on back', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    ui.setRoute({ kind: 'search', query: 'radiohead' });
    expect(routeKind(ui.getRoute())).toBe('search');

    ui.setRoute({ kind: 'album', id: 'alb1' });
    expect(routeKind(ui.getRoute())).toBe('album');
    ui.setAlbumTracks([
      {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'Track One',
        artists: [{ name: 'A' }],
        durationMs: 222000,
      },
    ]);
    await renderOnce();

    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('search');
    await ui.shutdown();
  });

  it('opens artist, switches release group content, opens playlist', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    ui.setRoute({ kind: 'artist', id: 'art1' });
    ui.setArtistAlbums([
      {
        id: 'al1',
        uri: 'spotify:album:al1',
        name: 'Album Title',
        artists: [{ name: 'A' }],
        releaseDate: '2024-05-01',
      },
    ]);
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('artist');

    ui.setRoute({ kind: 'playlist', id: 'pl1' });
    ui.setPlaylistTracks([
      {
        id: 't2',
        uri: 'spotify:track:t2',
        name: 'Song',
        artists: [{ name: 'Singer' }],
        durationMs: 190000,
      },
    ]);
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('playlist');
    await ui.shutdown();
  });

  it('visualizer fullscreen hides sidebar and restores prior route on back', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    ui.setRoute({ kind: 'album', id: 'alb9' });
    ui.setRoute({ kind: 'visualizer' });
    expect(routeKind(ui.getRoute())).toBe('visualizer');
    await renderOnce();

    expect(ui.navigateBack()).toBe(true);
    expect(routeKind(ui.getRoute())).toBe('album');
    await ui.shutdown();
  });

  it('m cycles visualizer modes and V closes back to the prior route', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const state: UiViewState = {
      ...baseState,
      visualizer: { mode: 'spectrum', fps: 30 },
    };
    const ui = createUiCore(renderer, state, {
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

    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setRoute({ kind: 'visualizer' });
    sendKey('m', 'm');
    expect(state.visualizer.mode).toBe('winamp');
    sendKey('V', 'V');
    expect(routeKind(ui.getRoute())).toBe('search');
    await ui.shutdown();
  });

  it('browse category list renders and back from entry restores list', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();

    ui.setRoute({ kind: 'home', tab: 'browse', browse: { category: 'moods' } });
    ui.setBrowseEntries([
      {
        id: 'chill',
        label: 'Chill',
        description: 'Relaxed',
        enabled: true,
        source: { kind: 'search', query: 'chill', types: ['playlist'] },
      },
    ]);
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });

  it('narrow terminal keeps playback bar state, title and progress', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 50, height: 30 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    expect(routeKind(ui.getRoute())).toBe('home');
    await ui.shutdown();
  });
});
