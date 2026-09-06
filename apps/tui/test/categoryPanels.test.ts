import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import type { CatalogArtistT, CatalogTrackT } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';
import type { HomeRow } from '../src/ui/views/homeRows';

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

const track = (id: string): CatalogTrackT => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
  durationMs: 1000,
});

const artist = (id: string): CatalogArtistT => ({
  id,
  uri: `spotify:artist:${id}`,
  name: id,
});

function makeUi() {
  return createTestRenderer({ width: 120, height: 40 }).then(
    ({ renderer, renderOnce, captureCharFrame }) => {
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
      return { ui, renderOnce, sendKey, captureCharFrame };
    },
  );
}

const homeRows = (): HomeRow[] => [
  { kind: 'track', track: track('t1') },
  { kind: 'track', track: track('t2') },
  { kind: 'artist', artist: artist('a1') },
  { kind: 'artist', artist: artist('a2') },
  { kind: 'track', track: track('r1'), playedAt: '2026-09-01T10:00:00.000Z' },
];

describe('category panels', () => {
  it('Tab cycles home panels tracks, artists, recent, discover', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setHomeItems([
      ...homeRows(),
      { kind: 'discover', id: 'moods', label: 'Moods', description: '3 sections' },
    ]);
    await renderOnce();

    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't1' });
    sendKey('tab', '\t');
    expect(ui.getContextTarget()).toMatchObject({ kind: 'artist', id: 'a1' });
    sendKey('tab', '\t');
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 'r1' });
    sendKey('tab', '\t');
    expect(ui.getContextTarget()).toMatchObject({ kind: 'browse-entry', id: 'moods' });
    sendKey('tab', '\t');
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't1' });
    await ui.shutdown();
  });

  it('Tab cycles search panels across categories', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();
    ui.setRoute({ kind: 'search', query: 'q' });
    ui.setSearchResults('q', {
      query: 'q',
      hits: [
        {
          type: 'artist' as const,
          artist: { id: 'sa1', uri: 'spotify:artist:sa1', name: 'sa1' },
        },
        {
          type: 'track' as const,
          track: {
            id: 'st1',
            uri: 'spotify:track:st1',
            name: 'st1',
            artists: [{ id: 'a', name: 'A', uri: 'spotify:artist:a' }],
            durationMs: 1000,
          },
        },
      ],
    });
    await renderOnce();
    // Tracks panel focused by default.
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 'st1' });
    sendKey('tab', '\t');
    expect(ui.getContextTarget()).toMatchObject({ kind: 'artist', id: 'sa1' });
    await ui.shutdown();
  });

  it('restores per-panel positions independently', async () => {
    const { ui, renderOnce, sendKey } = await makeUi();
    await renderOnce();
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setHomeItems(homeRows());
    await renderOnce();

    sendKey('tab', '\t');
    sendKey('down', '\u001b[B');
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ kind: 'artist', id: 'a2' });

    ui.setRoute({ kind: 'search', query: 'q' });
    expect(ui.navigateBack()).toBe(true);
    ui.setHomeItems(homeRows());
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ kind: 'artist', id: 'a2' });
    await ui.shutdown();
  });

  it('renders four titled home panels with even columns', async () => {
    const { ui, renderOnce, captureCharFrame } = await makeUi();
    await renderOnce();
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setHomeItems(homeRows(), { rangeLabel: '6 months' });
    await renderOnce();
    const frame = captureCharFrame();
    for (const title of ['Top Tracks', 'Top Artists', 'Recently Played', 'Discover']) {
      expect(frame).toContain(title);
    }
    expect(frame).toContain('6 months');
    const row = frame
      .split('\n')
      .find((line) => line.includes('Top Tracks') && line.includes('Top Artists'));
    expect(row).toBeDefined();
    // Equal columns: both panel boxes have the same width.
    // Equal columns: both panel boxes have the same width (a11y active marker ▶ included).
    const firstBox = row?.indexOf('Top Tracks') ?? -1;
    const secondBox = row?.indexOf('Top Artists') ?? -1;
    expect(firstBox).toBeGreaterThanOrEqual(0);
    expect(secondBox).toBeGreaterThan(firstBox);
    const firstWidth = secondBox - firstBox;
    const secondWidth = (row?.length ?? 0) - secondBox - 2;
    expect(Math.abs(firstWidth - secondWidth)).toBeLessThanOrEqual(2);
    await ui.shutdown();
  });

  it('shows per-panel empty states instead of blank panels', async () => {
    const { ui, renderOnce, captureCharFrame } = await makeUi();
    await renderOnce();
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setHomeItems([]);
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain('(no top tracks yet)');
    expect(frame).toContain('(no top artists yet)');
    expect(frame).toContain('(nothing played recently)');
    expect(frame).toContain('(no categories)');
    await ui.shutdown();
  });

  it('stacks grids vertically on narrow terminals without crashing', async () => {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });
    await renderOnce();
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setHomeItems(homeRows());
    resize(70, 30);
    await renderOnce();
    expect(ui.getContextTarget()).toMatchObject({ kind: 'track', id: 't1' });
    await ui.shutdown();
  });
});
