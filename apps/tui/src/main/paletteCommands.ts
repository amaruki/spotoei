import { routeKind } from '../ui/core/navigationStack';
import type { ContextTarget, Ui } from '../ui/types';
import { contextActionCommands } from './paletteContextActions';
import type { AppContext } from './types';

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
}

export interface PaletteCommand {
  name: string;
  description: string;
  action: () => void;
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
    { name: 'Search', description: '/', action: () => getUi()?.setRoute('search') },
    { name: 'Library', description: 'r', action: () => getUi()?.setRoute('library') },
    { name: 'Queue', description: 'u', action: () => getUi()?.setRoute('queue') },
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
        const pbState = state.currentInfo.playback?.state ?? 'idle';
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
      name: 'Toggle Visualizer Display',
      description: 'V',
      action: () => {
        const u = getUi();
        if (u) {
          const visible = u.toggleVisualizer();
          u.setStatus(
            visible
              ? `Visualizer enabled (${state.currentInfo.visualizer.mode})`
              : 'Visualizer hidden',
          );
        }
      },
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
      description: 'OAuth (press A in settings)',
      action: actions.triggerAuth,
    },
    { name: 'Quit Spotoei', description: 'q / Ctrl-C', action: () => void quit() },
  ];
}
