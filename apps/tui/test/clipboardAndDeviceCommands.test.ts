import { describe, expect, it } from 'bun:test';
import { parseSpotifyUriOrUrl, handleOpenFromClipboard } from '../src/main/clipboardPlayback';
import { switchPlaybackDeviceModal } from '../src/main/deviceSwitcher';
import { getNavOptions, getStatusBadge } from '../src/ui/views/nav';
import { buildPaletteCommands } from '../src/main/paletteCommands';
import { createKeyHandler } from '../src/main/keys';
import type { AppContext } from '../src/main/types';
import type { ContextMenuItem, Ui } from '../src/ui/types';

describe('Clipboard Spotify URI/Link Parser', () => {
  it('parses raw Spotify URIs', () => {
    expect(parseSpotifyUriOrUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toEqual({
      type: 'track',
      id: '4cOdK2wGLETKBW3PvgPWqT',
      uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    });
    expect(parseSpotifyUriOrUrl('spotify:album:1DFixLWuPkv3KT3TnV35m3')).toEqual({
      type: 'album',
      id: '1DFixLWuPkv3KT3TnV35m3',
      uri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    });
    expect(parseSpotifyUriOrUrl('spotify:artist:06HL4z0CvFAxyc27GXpf02')).toEqual({
      type: 'artist',
      id: '06HL4z0CvFAxyc27GXpf02',
      uri: 'spotify:artist:06HL4z0CvFAxyc27GXpf02',
    });
    expect(parseSpotifyUriOrUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      type: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    });
  });

  it('parses open.spotify.com web URLs with and without https', () => {
    expect(
      parseSpotifyUriOrUrl(
        'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=03c399b25ee44a4b',
      ),
    ).toEqual({
      type: 'track',
      id: '4cOdK2wGLETKBW3PvgPWqT',
      uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    });

    expect(parseSpotifyUriOrUrl('open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')).toEqual({
      type: 'album',
      id: '1DFixLWuPkv3KT3TnV35m3',
      uri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    });

    expect(
      parseSpotifyUriOrUrl('https://open.spotify.com/intl-es/artist/06HL4z0CvFAxyc27GXpf02'),
    ).toEqual({
      type: 'artist',
      id: '06HL4z0CvFAxyc27GXpf02',
      uri: 'spotify:artist:06HL4z0CvFAxyc27GXpf02',
    });

    expect(
      parseSpotifyUriOrUrl(
        'https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M?si=123',
      ),
    ).toEqual({
      type: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    });
  });

  it('rejects invalid or non-Spotify strings', () => {
    expect(parseSpotifyUriOrUrl('')).toBeNull();
    expect(parseSpotifyUriOrUrl('https://youtube.com/watch?v=123')).toBeNull();
    expect(parseSpotifyUriOrUrl('just some random text')).toBeNull();
    expect(parseSpotifyUriOrUrl('spotify:track:' + 'a'.repeat(1025))).toBeNull();
  });
});

describe('handleOpenFromClipboard', () => {
  it('loads track and starts playback', async () => {
    const loaded: unknown[] = [];
    let played = false;
    let statusSet = '';

    const ctx = {
      clients: {
        playback: {
          load: async (opts: unknown) => {
            loaded.push(opts);
          },
          play: async () => {
            played = true;
          },
        },
      },
      getUi: () =>
        ({
          setStatus: (msg: string) => {
            statusSet = msg;
          },
        }) as unknown as Ui,
    } as unknown as AppContext;

    const res = await handleOpenFromClipboard(
      ctx,
      undefined,
      undefined,
      'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    );
    expect(res).toBe(true);
    expect(loaded).toEqual([{ trackUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT' }]);
    expect(played).toBe(true);
    expect(statusSet).toContain('Playing track from clipboard');
  });

  it('delegates to playTrackOrContext when available', async () => {
    const playActions: unknown[] = [];
    const ctx = {
      clients: {},
      getUi: () =>
        ({
          setStatus: () => {},
        }) as unknown as Ui,
    } as unknown as AppContext;

    const actions = {
      playTrackOrContext: async (opts: unknown) => {
        playActions.push(opts);
      },
    };

    const res = await handleOpenFromClipboard(
      ctx,
      actions,
      undefined,
      'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3',
    );
    expect(res).toBe(true);
    expect(playActions).toEqual([
      {
        contextUri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3',
        title: 'album (1DFixLWuPkv3KT3TnV35m3)',
      },
    ]);
  });
  it('rejects 50MB clipboard input with clean status error', async () => {
    let statusMsg = '';
    let isError = false;
    const ctx = {
      clients: {},
      getUi: () =>
        ({
          setStatus: (msg: string, err?: boolean) => {
            statusMsg = msg;
            isError = !!err;
          },
        }) as unknown as Ui,
    } as unknown as AppContext;

    const hugeInput = 'a'.repeat(50 * 1024 * 1024);
    const res = await handleOpenFromClipboard(ctx, undefined, undefined, hugeInput);
    expect(res).toBe(false);
    expect(statusMsg).toBe('Clipboard content too large');
    expect(isError).toBe(true);
  });

  it('strips non-printable and control characters before parsing', async () => {
    let played = false;
    const ctx = {
      clients: {
        playback: {
          load: async () => {},
          play: async () => {
            played = true;
          },
        },
      },
      getUi: () =>
        ({
          setStatus: () => {},
        }) as unknown as Ui,
    } as unknown as AppContext;

    const res = await handleOpenFromClipboard(
      ctx,
      undefined,
      undefined,
      '\x00\x1bspotify:track:4cOdK2wGLETKBW3PvgPWqT\r\n\x7f',
    );
    expect(res).toBe(true);
    expect(played).toBe(true);
  });
});

describe('Device Switcher Modal', () => {
  it('fetches devices and opens context menu to transfer playback', async () => {
    let openedTitle = '';
    let menuItems: ContextMenuItem[] = [];
    let transferredDevice = '';
    let statusMsg = '';

    const fakeTransport = {
      async request(path: string, body: unknown = {}) {
        if (path === '/me/player/devices') {
          return {
            devices: [
              { id: 'dev-1', name: 'MacBook Pro', is_active: true, type: 'Computer' },
              { id: 'dev-2', name: 'Living Room TV', is_active: false, type: 'CastVideo' },
            ],
          };
        }
        if (path === '/me/player') {
          const b = body as { device_ids: string[]; play: boolean };
          transferredDevice = b.device_ids[0] ?? '';
          return null;
        }
        return null;
      },
    };

    const fakeUi = {
      setStatus: (msg: string) => {
        statusMsg = msg;
      },
      openContextMenu: (title: string, items: ContextMenuItem[]) => {
        openedTitle = title;
        menuItems = items;
      },
    } as unknown as Ui;

    const ctx = {
      clients: {
        webApi: {
          getTransport: () => fakeTransport,
        },
      },
      getUi: () => fakeUi,
    } as unknown as AppContext;

    await switchPlaybackDeviceModal(ctx, () => fakeUi);

    expect(openedTitle).toBe('Switch Playback Device');
    expect(menuItems.length).toBe(2);
    expect(menuItems[0]?.label).toContain('MacBook Pro (Active)');
    expect(menuItems[1]?.label).toBe('Living Room TV');

    // Run item 1 to transfer playback
    await menuItems[1]?.run();
    expect(transferredDevice).toBe('dev-2');
    expect(statusMsg).toContain('Playback transferred to Living Room TV');
  });
});

describe('Private Session Status Badge & Nav Options', () => {
  it('computes status badge correctly', () => {
    expect(getStatusBadge(true)).toBe('🕶 [Private]');
    expect(getStatusBadge(false)).toBe('');
  });

  it('nav options show private badge when private session is active', () => {
    const normal = getNavOptions(true, false);
    const privateNav = getNavOptions(true, true);

    expect(normal.find((o) => o.value === 'settings')?.name).toBe('Settings');
    expect(privateNav.find((o) => o.value === 'settings')?.name).toContain('🕶');
    expect(privateNav.find((o) => o.value === 'settings')?.description).toContain(
      'Private Session active',
    );
  });
});

describe('Palette Commands and Key Handlers', () => {
  it('registers device switcher, clipboard playback, and private session commands', () => {
    let lastStatus = '';
    const state = {
      isPrivateSession: false,
      currentInfo: { isPrivateSession: false },
      homeTabs: {},
      lastPlaybackState: 'idle',
    };
    const ctx = {
      clients: {
        playback: {},
        webApi: {},
      },
      state,
      getUi: () =>
        ({
          setStatus: (msg: string) => {
            lastStatus = msg;
          },
        }) as unknown as Ui,
      quit: async () => {},
    } as unknown as AppContext;

    const actions = {
      triggerAuth: async () => {},
      triggerLogout: async () => {},
      loadCurrentLyrics: async () => {},
      nextTrack: async () => {},
      previousTrack: async () => {},
      toggleShuffle: async () => {},
      toggleRepeat: async () => {},
      toggleAutoplay: async () => {},
      seekRelative: async () => {},
      changeVolume: async () => {},
      cycleVisualizerMode: () => {},
    };

    const cmds = buildPaletteCommands(ctx, actions, ctx.getUi, ctx.quit);
    const switchCmd = cmds.find((c) => c.name === 'Switch Playback Device...');
    const clipCmd = cmds.find((c) => c.name === 'Open Spotify Link / URI from Clipboard');
    const privCmd = cmds.find((c) => c.name === 'Toggle Private Session');

    expect(switchCmd).toBeDefined();
    expect(clipCmd).toBeDefined();
    expect(privCmd).toBeDefined();

    // Toggle private session
    privCmd?.action();
    expect(state.isPrivateSession).toBe(true);
    expect(lastStatus).toContain('Private Session enabled 🕶 [Private]');

    privCmd?.action();
    expect(state.isPrivateSession).toBe(false);
    expect(lastStatus).toContain('Private Session disabled');
  });

  it('triggers clipboard playback via key handler with o or Ctrl-V', async () => {
    const ctx = {
      clients: {
        playback: {},
      },
      state: {
        currentInfo: {
          auth: { state: 'authenticated' },
          visualizer: { mode: 'off' },
        },
      },
      getUi: () =>
        ({
          isAnyInputFocused: () => false,
          setStatus: () => {},
        }) as unknown as Ui,
      quit: async () => {},
    } as unknown as AppContext;

    const keyHandler = createKeyHandler(ctx, {
      triggerAuth: async () => {},
      loadLibrary: async () => {},
      loadCurrentLyrics: async () => {},
      updateQueueView: async () => {},
      ensureAutoplayTracks: async () => {},
      playTrackOrContext: async () => {},
      nextTrack: async () => {},
      previousTrack: async () => {},
      toggleShuffle: async () => {},
      toggleRepeat: async () => {},
      toggleAutoplay: async () => {},
      seekRelative: async () => {},
      changeVolume: async () => {},
      openContextMenuFor: () => {},
    });

    // We can verify keyHandler handles 'o' and Ctrl+v without throwing
    keyHandler({
      name: 'o',
      sequence: 'o',
      ctrl: false,
      shift: false,
      meta: false,
      raw: 'o',
    });

    keyHandler({
      name: 'v',
      sequence: '\x16',
      ctrl: true,
      shift: false,
      meta: false,
      raw: '\x16',
    });
  });
});
