import { describe, expect, it, vi } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type LibraryItemT, type UiViewState } from '../src/ui';
import { parseMotionCount } from '../src/ui/core/keyboardMotion';

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

function createTracks(count: number): LibraryItemT[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `t${i}`,
        uri: `spotify:track:t${i}`,
        name: `Track ${i}`,
        kind: 'track',
      }) as unknown as LibraryItemT,
  );
}
async function makeUi() {
  const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
  const ui = createUiCore(renderer, baseState, {
    onKey: () => {},
    onSearchSubmit: () => {},
    onSelectLibrary: () => {},
    onSelectQueue: () => {},
    vimTimeoutMs: 500,
  });
  const sendKey = (name: string, sequence: string, shift = false, ctrl = false) => {
    renderer.keyInput.emit('keypress', {
      name,
      sequence,
      ctrl,
      shift,
      meta: false,
    } as unknown as KeyEvent);
  };
  return { ui, renderOnce, sendKey };
}

describe('vim motion and count prefix', () => {
  it('moves down by count with 5j and up with 3k in library list', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    expect(ui.getContextTarget()).toMatchObject({ id: 't0' });

    // 5j -> jump 5 down to index 5
    sendKey('5', '5');
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't5' });

    // 10j -> jump 10 down to index 15
    sendKey('1', '1');
    sendKey('0', '0');
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't15' });

    // 3k -> jump 3 up to index 12
    sendKey('3', '3');
    sendKey('k', 'k');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't12' });

    // Plain j moves by 1
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't13' });

    await ui.shutdown();
  });

  it('jumps to top with gg and bottom with G', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    // Start at index 10
    sendKey('1', '1');
    sendKey('0', '0');
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't10' });

    // G -> jump to bottom (last index 29)
    sendKey('G', 'G', true);
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't29' });

    // gg -> jump to top (index 0)
    sendKey('g', 'g');
    sendKey('g', 'g');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't0' });

    // 8G -> jump to 8th item (index 7)
    sendKey('8', '8');
    sendKey('G', 'G', true);
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't7' });

    await ui.shutdown();
  });

  it('resets count buffer on timeout', async () => {
    vi.useFakeTimers();
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    expect(ui.getContextTarget()).toMatchObject({ id: 't0' });

    // Send 8, wait for timeout to expire
    sendKey('8', '8');
    vi.advanceTimersByTime(600);

    // j should now only move by 1 step because buffer was cleared
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't1' });

    vi.useRealTimers();
    await ui.shutdown();
  });

  it('resets count buffer on escape or non-motion key', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    // Send 5 then Escape
    sendKey('5', '5');
    sendKey('escape', '\u001b');

    // Next j should move by 1 step only
    sendKey('j', 'j');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't1' });

    await ui.shutdown();
  });

  it('supports down and up arrow keys with count multiplier', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    // 4 + down
    sendKey('4', '4');
    sendKey('down', '\u001b[B');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't4' });

    // 2 + up
    sendKey('2', '2');
    sendKey('up', '\u001b[A');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't2' });

    await ui.shutdown();
  });

  it('supports pagedown and pageup with count multiplier', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(30));
    await renderOnce();

    // 2 + pagedown -> moves 2 * 5 = 10 items
    sendKey('2', '2');
    sendKey('pagedown', '\u001b[6~');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't10' });

    // 1 + pageup -> moves 1 * 5 = 5 items up
    sendKey('1', '1');
    sendKey('pageup', '\u001b[5~');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ id: 't5' });

    await ui.shutdown();
  });

  it('does not trigger motion when an input is focused', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'search', query: '' });
    await renderOnce();
    expect(ui.isAnyInputFocused()).toBe(true);

    // Send 5j into search input — should not throw or navigate list
    sendKey('5', '5');
    sendKey('j', 'j');
    await renderOnce();

    await ui.shutdown();
  });

  it('clamps 99999999999j count buffer to 999', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setLibraryItems(createTracks(1500));
    await renderOnce();

    expect(ui.getContextTarget()).toMatchObject({ id: 't0' });

    // Send 11 '9's followed by 'j'
    for (let i = 0; i < 11; i++) {
      sendKey('9', '9');
    }
    sendKey('j', 'j');
    await renderOnce();

    // Clamped to 999 -> moves down by 999 to index 999 (t999)
    expect(ui.getContextTarget()).toMatchObject({ id: 't999' });

    await ui.shutdown();
  });

  it('parseMotionCount clamps buffer correctly', () => {
    expect(parseMotionCount('')).toBe(1);
    expect(parseMotionCount('0')).toBe(1);
    expect(parseMotionCount('-5')).toBe(1);
    expect(parseMotionCount('abc')).toBe(1);
    expect(parseMotionCount('5')).toBe(5);
    expect(parseMotionCount('999')).toBe(999);
    expect(parseMotionCount('99999999999')).toBe(999);
  });
});
