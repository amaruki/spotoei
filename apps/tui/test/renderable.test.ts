import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createUiCore, type UiViewState } from '../src/ui';

describe('OpenTUI renderables integration', () => {
  const dummyState: UiViewState = {
    protocol: 1,
    playerVersion: '0.1.0',
    capabilities: ['audio', 'visualizer'],
    auth: { state: 'authenticated', accountId: 'test-user', storage: 'keyring' },
    playback: {
      state: 'playing',
      track: {
        uri: 'spotify:track:123',
        name: 'Test Track',
        artist: 'Test Artist',
        album: 'Test Album',
        durationMs: 180000,
      },
      positionMs: 45000,
      volume: 80,
      shuffle: false,
      repeat: 'off',
    },
    queue: {
      current: {
        uri: 'spotify:track:123',
        name: 'Test Track',
        artists: ['Test Artist'],
        albumName: 'Test Album',
        durationMs: 180000,
      },
      upcoming: [
        {
          uri: 'spotify:track:456',
          name: 'Next Track',
          artists: ['Another Artist'],
          albumName: 'Next Album',
          durationMs: 200000,
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
    const ui = createUiCore(renderer, dummyState, {
      onKey: (k) => {
        keyEvents.push(k.name);
      },
    });

    expect(renderer.root.getChildren().length).toBeGreaterThan(0);

    // Initial render
    await renderOnce();

    // Verify route switching
    ui.setRoute('search');
    expect(ui.getRoute()).toBe('search');
    await renderOnce();

    ui.setRoute('library');
    expect(ui.getRoute()).toBe('library');
    await renderOnce();

    ui.setRoute('queue');
    expect(ui.getRoute()).toBe('queue');
    await renderOnce();

    ui.setRoute('lyrics');
    expect(ui.getRoute()).toBe('lyrics');
    await renderOnce();

    // Verify search results rendering
    ui.setSearchResults('test', {
      query: 'test',
      hits: [
        {
          type: 'track',
          track: {
            uri: 'spotify:track:hit1',
            name: 'Search Hit Track',
            artists: ['Hit Artist'],
            album: 'Hit Album',
            durationMs: 150000,
            explicit: false,
          },
        },
      ],
    });
    await renderOnce();

    // Verify queue snapshot rendering
    ui.setQueueSnapshot({
      current: {
        uri: 'spotify:track:123',
        name: 'Playing Track',
        artists: ['Artist A'],
        albumName: 'Album A',
        durationMs: 180000,
      },
      upcoming: [
        {
          uri: 'spotify:track:789',
          name: 'Queued Track 1',
          artists: ['Artist B'],
          albumName: 'Album B',
          durationMs: 210000,
        },
      ],
      revision: 2,
    });
    await renderOnce();

    // Verify lyrics rendering
    ui.setLyrics({
      uri: 'spotify:track:123',
      kind: 'synced',
      lines: [
        { startMs: 1000, text: 'First line of song' },
        { startMs: 5000, text: 'Second line of song' },
      ],
    });
    await renderOnce();

    // Verify visualizer frame rendering
    ui.setVisualizerFrame({
      mode: 'spectrum',
      data: [0.1, 0.5, 0.8, 0.3, 0.9, 0.2, 0.6, 0.4],
    });
    await renderOnce();

    ui.setVisualizerFrame({
      mode: 'waveform',
      data: [0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5],
    });
    await renderOnce();

    // Verify status message
    ui.setStatus('Test status message');
    await renderOnce();

    await ui.shutdown();
  });
});
