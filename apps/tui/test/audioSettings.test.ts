import { describe, expect, it } from 'bun:test';
import { getSettingsContent } from '../src/ui/views/settings';
import { buildPaletteCommands } from '../src/main/paletteCommands';
import type { UiViewState, Ui } from '../src/ui/types';
import type { AppContext } from '../src/main/types';

describe('Audio Engine Settings & Palette Commands', () => {
  it('renders Audio Engine & Librespot section in settings view', () => {
    const state: UiViewState = {
      protocol: 1,
      playerVersion: '0.1.0',
      capabilities: ['lyrics.synced'],
      auth: {
        v: 1,
        state: 'authenticated',
        accountId: 'test-user',
        storage: 'keyring',
        scopes: [],
        accessTokenExpiresAt: null,
        authUrl: null,
      },
      playback: null,
      queue: { current: null, upcoming: [], revision: 0 },
      visualizer: { mode: 'off', fps: 30 },
      audioConfig: {
        deviceMode: 'integrated',
        audioBackend: 'rodio (default)',
        bitrate: '320',
        crossfadeDurationMs: 3000,
        normalisation: true,
        pregain: 2.0,
      },
    };

    const content = getSettingsContent(state);
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    expect(text).toContain('Audio Engine & Librespot');
    expect(text).toContain('Integrated (Local Audio)');
    expect(text).toContain('rodio');
    expect(text).toContain('320 kbps');
    expect(text).toContain('3.0s (3000 ms)');
    expect(text).toContain('Enabled');
    expect(text).toContain('+2 dB');
    expect(text).toContain('Cache:');
  });

  it('includes audio engine actions in palette commands', async () => {
    const lastSetHolder: {
      cfg: { deviceMode?: string; bitrate?: string; normalisation?: boolean; crossfadeDurationMs?: number } | null;
    } = { cfg: null };
    let lastStatus = '';
    const fakePlayback = {
      setAudioConfig: async (cfg: Record<string, unknown>) => {
        lastSetHolder.cfg = cfg;
        return {
          deviceMode: cfg.deviceMode ?? 'integrated',
          audioBackend: 'rodio',
          bitrate: cfg.bitrate ?? '320',
          crossfadeDurationMs: cfg.crossfadeDurationMs ?? 0,
          normalisation: cfg.normalisation ?? true,
          pregain: 0,
        };
      },
    };

    const ctx = {
      clients: {
        playback: fakePlayback,
      },
      state: {
        currentInfo: {
          audioConfig: {
            deviceMode: 'integrated',
            bitrate: '320',
            normalisation: true,
            crossfadeDurationMs: 0,
          },
        },
      },
    } as unknown as AppContext;

    const fakeUi = {
      setAudioConfig: () => {},
      setStatus: (msg: string) => {
        lastStatus = msg;
      },
    } as unknown as Ui;

    const dummyActions = {} as unknown as Parameters<typeof buildPaletteCommands>[1];
    const cmds = buildPaletteCommands(
      ctx,
      dummyActions,
      () => fakeUi,
      async () => {},
    );

    const toggleMode = cmds.find((c) => c.name.includes('Device Mode'));
    expect(toggleMode).toBeDefined();
    toggleMode!.action();
    await Promise.resolve();
    await Promise.resolve();
    expect(lastSetHolder.cfg?.deviceMode).toBe('connect_only');
    expect(lastStatus).toContain('Connect Only');

    const cycleBitrate = cmds.find((c) => c.name.includes('Cycle Audio Bitrate'));
    expect(cycleBitrate).toBeDefined();
    cycleBitrate!.action();
    await Promise.resolve();
    await Promise.resolve();
    expect(lastSetHolder.cfg?.bitrate).toBe('160');
    expect(lastStatus).toContain('160 kbps');

    const toggleNorm = cmds.find((c) => c.name.includes('Toggle Audio Normalisation'));
    expect(toggleNorm).toBeDefined();
    toggleNorm!.action();
    await Promise.resolve();
    await Promise.resolve();
    expect(lastSetHolder.cfg?.normalisation).toBe(false);
    expect(lastStatus).toContain('Disabled');

    const adjustCrossfade = cmds.find((c) => c.name.includes('Adjust Crossfade Duration'));
    expect(adjustCrossfade).toBeDefined();
    adjustCrossfade!.action();
    await Promise.resolve();
    await Promise.resolve();
    expect(lastSetHolder.cfg?.crossfadeDurationMs).toBe(2000);
    expect(lastStatus).toContain('2s');
  });
});
