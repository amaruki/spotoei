import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
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

function makeUi() {
  return createTestRenderer({ width: 120, height: 40 }).then(({ renderer, renderOnce }) => {
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    const sendKey = (name: string, sequence: string) => {
      renderer.keyInput.emit('keypress', {
        name,
        sequence,
        ctrl: false,
        shift: false,
        meta: false,
      } as unknown as KeyEvent);
    };
    return { ui, renderOnce, sendKey };
  });
}

describe('context menu overlay', () => {
  it('opens, runs the selected action, and closes', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();

    const ran: string[] = [];
    ui.openContextMenu('Song', [
      { label: 'Play', hint: 'Enter', run: () => ran.push('play') },
      { label: 'Like', hint: 'x menu', run: () => ran.push('like') },
    ]);
    expect(ui.isContextMenuOpen()).toBe(true);

    sendKey('down', '\u001b[B');
    sendKey('return', '\r');
    expect(ran).toEqual(['like']);
    expect(ui.isContextMenuOpen()).toBe(false);
    await ui.shutdown();
  });

  it('Esc closes the menu and restores focus without navigating', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'search', query: 'q' });
    ui.openContextMenu('Song', [{ label: 'Play', run: () => {} }]);
    expect(ui.isContextMenuOpen()).toBe(true);
    sendKey('escape', '\u001b');
    expect(ui.isContextMenuOpen()).toBe(false);
    expect(ui.getRoute()).toEqual({ kind: 'search', query: 'q' });
    await ui.shutdown();
  });

  it('Enter on a disabled item keeps the menu open with a reason', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();

    const ran: string[] = [];
    ui.openContextMenu('Song', [
      { label: 'Follow', run: () => ran.push('follow'), disabled: true, reason: 'Not validated' },
    ]);
    sendKey('return', '\r');
    expect(ran).toEqual([]);
    expect(ui.isContextMenuOpen()).toBe(true);
    await ui.shutdown();
  });

  it('resolves the selected search hit as a context target', async () => {
    const { ui, renderOnce } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'search', query: 'cold' });
    ui.setSearchResults('cold', {
      query: 'cold',
      hits: [
        {
          type: 'track',
          track: {
            id: 't1',
            uri: 'spotify:track:t1',
            name: 'Cold',
            artists: [{ id: 'a1', name: 'A', uri: 'spotify:artist:a1' }],
            durationMs: 200000,
          },
        },
      ],
    });
    // Tracks panel is focused by default: first row maps to the track hit.
    const target = ui.getContextTarget();
    expect(target?.kind).toBe('track');
    expect(target?.id).toBe('t1');
    await ui.shutdown();
  });

  it('resolves entity list rows and browse entries as targets', async () => {
    const { ui, renderOnce } = await makeUi();
    await renderOnce();

    ui.setRoute({ kind: 'album', id: 'al1' });
    ui.setAlbumTracks([
      {
        id: 't9',
        uri: 'spotify:track:t9',
        name: 'Ninth',
        artists: [{ name: 'A' }],
        durationMs: 180000,
      },
    ]);
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't9' });

    ui.setRoute({ kind: 'browse', path: { category: 'moods' } });
    ui.setBrowseEntries([
      {
        id: 'chill',
        label: 'Chill',
        description: 'Relaxed',
        enabled: true,
        source: { kind: 'search', query: 'chill', types: ['playlist'] },
      },
    ]);
    expect(ui.getContextTarget()).toMatchObject({ kind: 'browse-entry', id: 'chill' });
    await ui.shutdown();
  });
});
