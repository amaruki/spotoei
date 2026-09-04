import { resolveClientId } from '../config';
import type { KeyDispatch } from '../ui';
import { routeKind } from '../ui/core/navigationStack';
import type { ContextTarget } from '../ui/types';
import { isLowerKey, isUpperKey } from './utils';
import type { AppContext } from './types';

export function createKeyHandler(
  ctx: AppContext,
  actions: {
    triggerAuth: () => Promise<void>;
    loadLibrary: (force?: boolean) => Promise<void>;
    loadCurrentLyrics: (force?: boolean) => Promise<void>;
    updateQueueView: () => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    playTrackOrContext: (opts: {
      trackUri?: string;
      contextUri?: string;
      title: string;
    }) => Promise<void>;
    nextTrack: () => Promise<void>;
    previousTrack: () => Promise<void>;
    toggleShuffle: () => Promise<void>;
    toggleRepeat: () => Promise<void>;
    toggleAutoplay: () => Promise<void>;
    seekRelative: (deltaMs: number) => Promise<void>;
    changeVolume: (delta: number) => Promise<void>;
    openContextMenuFor: (target: ContextTarget) => void;
  },
): KeyDispatch {
  const { clients, state, getUi, quit } = ctx;

  return (key) => {
    const ui = getUi();
    if (key.ctrl && key.name === 'c') {
      void quit();
      return;
    }
    if (key.name === 'q' || key.name === 'Q') {
      void quit();
      return;
    }
    if (key.name === '?' || key.sequence === '?' || key.name === ':') {
      if (ui) ui.openPalette();
      return;
    }

    // If unauthenticated, gate player actions and offer direct login
    if (state.currentInfo.auth?.state !== 'authenticated') {
      if (isLowerKey(key, 'a') || key.name === 'return') {
        void actions.triggerAuth();
        return;
      }
      if (
        ['space', 'k', 'n', 'p', '/', 'r', 'u', 'l', 'v', 's'].includes(
          (key.name ?? '').toLowerCase(),
        ) ||
        isUpperKey(key, 's') ||
        isUpperKey(key, 'r') ||
        isUpperKey(key, 'a') ||
        isUpperKey(key, 'v')
      ) {
        if (ui) {
          const cRes = resolveClientId();
          if (!cRes.clientId) {
            ui.setStatus(
              'Setup required: Please enter Spotify Client ID first (press c to edit)',
              true,
            );
          } else {
            ui.setStatus(
              'Authentication required: Please log in with Spotify (press a or Enter to log in)',
              true,
            );
          }
        }
        return;
      }
    }

    if (key.name === 'escape') {
      if (ui) {
        const closed = ui.navigateBack();
        if (!closed) ui.setFocus('sidebar');
      }
      return;
    }
    if (key.name === 'tab') {
      state.activeFocus = state.activeFocus === 'sidebar' ? 'main' : 'sidebar';
      if (ui) ui.setFocus(state.activeFocus);
      return;
    }
    if (key.name === 'space' || key.name === 'k' || key.name === 'K') {
      const pbState = state.currentInfo.playback?.state ?? 'idle';
      void (async () => {
        try {
          if (pbState === 'playing') {
            await clients.webApi.pause().catch(() => {});
            await clients.playback.pause();
          } else {
            await clients.webApi.play({}).catch(() => {});
            await clients.playback.play();
          }
        } catch (e) {
          if (ui) ui.setStatus(`playback: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      return;
    }
    if (key.name === 'n' || key.name === 'N') {
      void actions.nextTrack();
      return;
    }
    if (key.name === 'p' || key.name === 'P') {
      void actions.previousTrack();
      return;
    }
    if (key.sequence === '>' || key.sequence === '.' || (key.ctrl && key.name === 'right')) {
      void actions.seekRelative(5000);
      return;
    }
    if (key.sequence === '<' || key.sequence === ',' || (key.ctrl && key.name === 'left')) {
      void actions.seekRelative(-5000);
      return;
    }
    if (key.sequence === '+' || key.sequence === '=') {
      void actions.changeVolume(0.05);
      return;
    }
    if (key.sequence === '-' || key.sequence === '_') {
      void actions.changeVolume(-0.05);
      return;
    }

    // Toggle Shuffle with 'S' (Shift+S)
    if (isUpperKey(key, 's')) {
      void actions.toggleShuffle();
      return;
    }

    // Settings route with 's' (lowercase)
    if (isLowerKey(key, 's')) {
      if (ui) ui.setRoute('settings');
      return;
    }

    // Toggle Repeat Mode with 'R' (Shift+R)
    if (isUpperKey(key, 'r')) {
      void actions.toggleRepeat();
      return;
    }

    // Library route & refresh with 'r' (lowercase)
    if (isLowerKey(key, 'r')) {
      if (ui) {
        ui.setRoute('library');
        void actions.loadLibrary(true);
      }
      return;
    }

    // Toggle Autoplay with 'A' (Shift+A)
    if (isUpperKey(key, 'a')) {
      void actions.toggleAutoplay();
      return;
    }

    // Authenticate with 'a' (lowercase)
    if (isLowerKey(key, 'a')) {
      void actions.triggerAuth();
      return;
    }

    // Queue route with 'u' or 'U'
    if ((key.name ?? '').toLowerCase() === 'u' || (key.sequence ?? '').toLowerCase() === 'u') {
      if (ui) {
        ui.setRoute('queue');
        void actions.updateQueueView();
        void actions.ensureAutoplayTracks();
      }
      return;
    }

    // Full-screen visualizer route with 'V' (Shift+V or v): toggle route
    if (isUpperKey(key, 'v') || isLowerKey(key, 'v')) {
      if (ui) {
        const cur = ui.getRoute();
        if (routeKind(cur) === 'visualizer') {
          ui.navigateBack();
          ui.setStatus('Exited visualizer');
        } else {
          ui.setRoute({ kind: 'visualizer' });
          ui.setStatus(`Visualizer (${state.currentInfo.visualizer.mode}) — V: close, m: mode`);
        }
      }
      return;
    }

    if (isLowerKey(key, 'l')) {
      if (ui) {
        const curRoute = ui.getRoute();
        if (routeKind(curRoute) === 'lyrics') {
          ui.setRoute(state.lastRouteBeforeLyrics);
          ui.setStatus(`Exited lyrics`);
        } else {
          state.lastRouteBeforeLyrics = curRoute;
          ui.setRoute('lyrics');
          void actions.loadCurrentLyrics();
        }
      }
      return;
    }
    if (isUpperKey(key, 'l')) {
      if (ui) {
        if (routeKind(ui.getRoute()) !== 'lyrics') {
          state.lastRouteBeforeLyrics = ui.getRoute();
          ui.setRoute('lyrics');
        }
        void actions.loadCurrentLyrics(true);
      }
      return;
    }
    if (key.name === '/') {
      if (ui) ui.setRoute('search');
      return;
    }
    if (key.name === 'x' || key.name === 'X') {
      if (ui) {
        const target = ui.getContextTarget();
        if (!target) {
          ui.setStatus('Nothing selected — move to a track, album, artist, or playlist first');
          return;
        }
        actions.openContextMenuFor(target);
      }
      return;
    }
  };
}
