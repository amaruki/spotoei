import type { ArtistReleaseGroupT, HomeTabT, TimeRangeT } from 'spotoei-protocol';
import type { SearchFilter } from '../ui/views/search';
import { routeKind } from '../ui/core/navigationStack';
import { setHomeRange } from '../home/tabs';
import type { ContextTarget, Ui } from '../ui/types';
import { switchArtistGroup } from './entityLoaders';
import { ensureHomeTab } from './homeLoad';
import { contextActionCommands } from './paletteContextActions';
import type { AppContext } from './types';
import { optimisticPlayback } from '../playback/validator';
import type { PlayTrackOpts } from './playback';
import { switchPlaybackDeviceModal } from './deviceSwitcher';
import { handleOpenFromClipboard } from './clipboardPlayback';
import { getStatusBadge } from '../ui/views/nav';

export interface PaletteActionDeps {
  triggerAuth: () => Promise<void>;
  loadCurrentLyrics: (force?: boolean) => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  toggleRepeat: () => Promise<void>;
  toggleAutoplay: () => Promise<void>;
  seekRelative: (deltaMs: number) => Promise<void>;
  changeVolume: (delta: number) => Promise<void>;
  cycleVisualizerMode: () => void;
  playTrackOrContext?: (opts: PlayTrackOpts) => Promise<void>;
}

export interface PaletteCommand {
  name: string;
  description: string;
  action: () => void;
  isAvailable?: () => boolean;
}

// Full command-palette list extracted from main/ui.ts for the LoC cap.
export function buildPaletteCommands(
  ctx: AppContext,
  actions: PaletteActionDeps,
  getUi: () => Ui | null,
  quit: () => Promise<void>,
  paletteContext?: {
    getTarget: () => ContextTarget | null;
    run: (action: string, target: ContextTarget) => void;
    notify: (msg: string) => void;
  },
): PaletteCommand[] {
  const { clients, state } = ctx;
  return [
    { name: 'Home View', description: 'Esc', action: () => getUi()?.setRoute('home') },
    { name: 'Browse', description: 'b', action: () => getUi()?.setRoute('browse') },
    { name: 'Search', description: '/', action: () => getUi()?.setRoute('search') },
    { name: 'Library', description: 'r', action: () => getUi()?.setRoute('library') },
    {
      name: 'Library: Tracks',
      description: 'saved tracks',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'saved_tracks' }),
    },
    {
      name: 'Library: Albums',
      description: 'saved albums',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'saved_albums' }),
    },
    {
      name: 'Library: Artists',
      description: 'followed artists',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'followed_artists' }),
    },
    {
      name: 'Library: Playlists',
      description: 'saved playlists',
      action: () => getUi()?.setRoute({ kind: 'library', section: 'playlists' }),
    },
    { name: 'Queue', description: 'u', action: () => getUi()?.setRoute('queue') },
    {
      name: 'Toggle Sidebar',
      description: 'collapse at medium widths',
      action: () => {
        const u = getUi();
        if (u) u.toggleSidebar();
      },
    },
    ...(['all', 'track', 'artist', 'album', 'playlist'] as SearchFilter[]).map((filter) => ({
      name: `Search filter: ${filter}`,
      description: 'result type filter',
      action: () => getUi()?.setSearchFilter(filter),
    })),
    ...(['for_you', 'recently_played'] as HomeTabT[]).map((tab) => ({
      name: `Home tab: ${tab}`,
      description: 'home tab',
      action: () => getUi()?.setRoute({ kind: 'home', tab }),
    })),
    ...(
      [
        ['4 weeks', 'short_term'],
        ['6 months', 'medium_term'],
        ['All time', 'long_term'],
      ] as Array<[string, TimeRangeT]>
    ).map(([label, range]) => ({
      name: `Home range: ${label}`,
      description: 'for you range',
      action: () => {
        ctx.state.homeTabs = setHomeRange(ctx.state.homeTabs, range);
        const u = getUi();
        const r = u?.getRoute();
        if (u && r?.kind === 'home' && r.tab === 'for_you') {
          void ensureHomeTab(
            {
              homeManager: ctx.clients.homeManager,
              entityManager: ctx.clients.entityManager,
              getUi,
              state: ctx.state,
            },
            'for_you',
            true,
          );
        } else {
          u?.setRoute({ kind: 'home', tab: 'for_you' });
        }
      },
    })),
    {
      name: 'Reload Home',
      description: 'refresh active home tab',
      action: () => {
        const u = getUi();
        const r = u?.getRoute();
        if (u && r?.kind === 'home') {
          void ensureHomeTab(
            {
              homeManager: ctx.clients.homeManager,
              entityManager: ctx.clients.entityManager,
              getUi,
              state: ctx.state,
            },
            r.tab,
            true,
          );
        }
      },
    },
    ...(['album', 'single', 'appears_on', 'compilation'] as ArtistReleaseGroupT[]).map((group) => ({
      name: `Artist releases: ${group}`,
      description: 'release group tab',
      action: () => {
        const u = getUi();
        const r = u?.getRoute();
        if (r?.kind === 'artist') {
          void switchArtistGroup(
            { entityManager: ctx.clients.entityManager, getUi, state: ctx.state },
            r.id,
            group,
          );
        } else {
          u?.setStatus('Open an artist page first, then switch release groups');
        }
      },
    })),
    {
      name: 'Toggle Lyrics View',
      description: 'l',
      action: () => {
        const u = getUi();
        if (u) {
          const curRoute = u.getRoute();
          if (routeKind(curRoute) === 'lyrics') {
            u.setRoute(state.lastRouteBeforeLyrics);
          } else {
            state.lastRouteBeforeLyrics = curRoute;
            u.setRoute('lyrics');
            void actions.loadCurrentLyrics();
          }
        }
      },
    },
    { name: 'Settings', description: 's', action: () => getUi()?.setRoute('settings') },
    ...(paletteContext
      ? contextActionCommands(paletteContext.getTarget, paletteContext.run, paletteContext.notify)
      : []),
    {
      name: 'Configure Spotify Client ID',
      description: 'Set/update Spotify Client ID',
      action: () => {
        const u = getUi();
        if (u) {
          u.focusClientIdInput();
          u.setStatus('Paste Spotify Client ID and press Enter to save', true);
        }
      },
    },
    {
      name: 'Toggle Play/Pause',
      description: 'Space / k',
      action: () => {
        const pbState =
          (optimisticPlayback.getEffectiveState() ?? state.currentInfo.playback)?.state ?? 'idle';
        if (pbState === 'playing') void clients.playback.pause().catch(() => {});
        else void clients.playback.play().catch(() => {});
      },
    },
    {
      name: 'Next Track',
      description: 'n',
      action: () => void actions.nextTrack(),
    },
    {
      name: 'Previous Track',
      description: 'p',
      action: () => void actions.previousTrack(),
    },
    {
      name: 'Seek Forward 5s',
      description: '> / .',
      action: () => void actions.seekRelative(5000),
    },
    {
      name: 'Seek Backward 5s',
      description: '< / ,',
      action: () => void actions.seekRelative(-5000),
    },
    {
      name: 'Volume Up (+5%)',
      description: '+ / =',
      action: () => void actions.changeVolume(0.05),
    },
    {
      name: 'Volume Down (-5%)',
      description: '- / _',
      action: () => void actions.changeVolume(-0.05),
    },
    {
      name: 'Toggle Shuffle',
      description: 'S',
      action: () => void actions.toggleShuffle(),
    },
    {
      name: 'Toggle Repeat Mode',
      description: 'R',
      action: () => void actions.toggleRepeat(),
    },
    {
      name: 'Toggle Autoplay',
      description: 'A',
      action: () => void actions.toggleAutoplay(),
    },
    {
      name: 'Cycle Visualizer Mode',
      description: 'v',
      action: () => {
        actions.cycleVisualizerMode();
      },
    },
    {
      name: 'Open Visualizer',
      description: 'V',
      action: () => {
        const u = getUi();
        if (u) {
          const cur = u.getRoute();
          if (routeKind(cur) === 'visualizer') {
            u.navigateBack();
            u.setStatus('Exited visualizer');
          } else {
            u.setRoute({ kind: 'visualizer' });
            u.setStatus(`Visualizer (${state.currentInfo.visualizer.mode}) — V: close, m: mode`);
          }
        }
      },
    },
    {
      name: 'Reload Lyrics',
      description: 'L',
      action: () => {
        void actions.loadCurrentLyrics(true);
      },
    },
    {
      name: 'Authenticate with Spotify',
      description: 'OAuth (press A in onboarding or Ctrl+A in settings)',
      action: actions.triggerAuth,
    },
    {
      name: 'Log Out of Spotify',
      description: 'Clear keyring tokens, session, and cache (Ctrl+L in settings)',
      action: actions.triggerLogout,
    },
    {
      name: 'Switch Playback Device...',
      description: 'Transfer playback to another device',
      action: () => {
        void switchPlaybackDeviceModal(ctx, getUi);
      },
    },
    {
      name: 'Open Spotify Link / URI from Clipboard',
      description: 'Play track/album/artist/playlist from clipboard (o / Ctrl-V)',
      action: () => {
        void handleOpenFromClipboard(ctx, actions, getUi);
      },
    },
    {
      name: 'Toggle Private Session',
      description: 'Hide listening activity',
      action: () => {
        const next = !ctx.state.isPrivateSession;
        ctx.state.isPrivateSession = next;
        if (ctx.state.currentInfo) {
          ctx.state.currentInfo.isPrivateSession = next;
        }
        const u = getUi();
        if (u) {
          const badge = getStatusBadge(next);
          u.setStatus(`Private Session ${next ? `enabled ${badge}` : 'disabled'}`);
        }
      },
    },
    {
      name: 'Toggle Device Mode (Integrated/ConnectOnly)',
      description: 'Switch between local audio playback and Spotify Connect receiver',
      action: () => {
        const cur = state.currentInfo.audioConfig?.deviceMode ?? 'integrated';
        const next = cur === 'connect_only' ? 'integrated' : 'connect_only';
        void clients.playback
          .setAudioConfig({ deviceMode: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(
              `Device Mode: ${next === 'connect_only' ? 'Connect Only (Remote)' : 'Integrated (Local)'}`,
            );
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set device mode: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Cycle Audio Bitrate',
      description: 'Cycle streaming quality (320k -> 160k -> 96k)',
      action: () => {
        const cur = state.currentInfo.audioConfig?.bitrate ?? '320';
        const next = cur === '320' ? '160' : cur === '160' ? '96' : '320';
        void clients.playback
          .setAudioConfig({ bitrate: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Audio Bitrate: ${next} kbps`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set bitrate: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Toggle Audio Normalisation',
      description: 'Enable or disable volume normalisation',
      action: () => {
        const cur = state.currentInfo.audioConfig?.normalisation !== false;
        const next = !cur;
        void clients.playback
          .setAudioConfig({ normalisation: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Audio Normalisation: ${next ? 'Enabled' : 'Disabled'}`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set normalisation: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Adjust Crossfade Duration',
      description: 'Cycle crossfade duration (Off -> 2s -> 5s -> 8s -> 12s)',
      action: () => {
        const cur = state.currentInfo.audioConfig?.crossfadeDurationMs ?? 0;
        const next =
          cur === 0 ? 2000 : cur <= 2000 ? 5000 : cur <= 5000 ? 8000 : cur <= 8000 ? 12000 : 0;
        void clients.playback
          .setAudioConfig({ crossfadeDurationMs: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Crossfade Duration: ${next > 0 ? `${next / 1000}s` : 'Off'}`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set crossfade: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    { name: 'Quit Spotoei', description: 'q / Ctrl-C', action: () => void quit() },
  ];
}
