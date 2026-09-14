import { routeKind } from '../ui/core/navigationStack';
import type { Ui } from '../ui/types';
import { optimisticPlayback } from '../playback/validator';
import type { PaletteActionDeps, PaletteCommand } from './paletteTypes';
import type { AppContext } from './types';

export function buildPalettePlaybackCommands(
  ctx: AppContext,
  actions: PaletteActionDeps,
  getUi: () => Ui | null,
): PaletteCommand[] {
  const { clients, state } = ctx;
  return [
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
  ];
}
