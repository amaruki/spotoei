import type { PlaybackCore } from './playbackCore';
import type { AppContext } from './types';

export function createTransportActions(ctx: AppContext, core: PlaybackCore) {
  const { clients, getUi } = ctx;
  const { getEffectivePlayback } = core;

  const toggleShuffle = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const next = !curPlayback?.shuffle;
    try {
      if (clients.webApi && typeof clients.webApi.shuffle === 'function') {
        void clients.webApi.shuffle(next).catch(() => {});
      }
      await clients.playback.setShuffle(next);
      ui?.setStatus(`Shuffle: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`shuffle: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleRepeat = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.repeat ?? 'off';
    const next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
    try {
      if (clients.webApi && typeof clients.webApi.repeat === 'function') {
        void clients.webApi.repeat(next).catch(() => {});
      }
      await clients.playback.setRepeat(next);
      ui?.setStatus(`Repeat: ${next.toUpperCase()}`);
    } catch (e) {
      ui?.setStatus(`repeat: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleAutoplay = async (): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const next = !curPlayback?.autoplay;
    try {
      await clients.playback.setAutoplay(next);
      ui?.setStatus(`Autoplay: ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      ui?.setStatus(`autoplay: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const seekRelative = async (deltaMs: number): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.positionMs ?? 0;
    const dur = curPlayback?.durationMs ?? 0;
    const nextPos = Math.max(0, Math.min(dur > 0 ? dur : cur + deltaMs, cur + deltaMs));
    try {
      if (clients.webApi && typeof clients.webApi.seek === 'function') {
        void clients.webApi.seek(nextPos).catch(() => {});
      }
      await clients.playback.seek(nextPos);
      const secs = Math.floor(nextPos / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      ui?.setStatus(`Seek: ${mins}:${remSecs.toString().padStart(2, '0')}`);
    } catch (e) {
      ui?.setStatus(`seek: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeVolume = async (delta: number): Promise<void> => {
    const ui = getUi();
    const curPlayback = getEffectivePlayback();
    const cur = curPlayback?.volume ?? 0.8;
    const nextVol = Math.round(Math.max(0.0, Math.min(1.0, cur + delta)) * 100) / 100;
    try {
      if (clients.webApi && typeof clients.webApi.setVolume === 'function') {
        void clients.webApi.setVolume(Math.round(nextVol * 100)).catch(() => {});
      }
      await clients.playback.setVolume(nextVol);
      ui?.setStatus(`Volume: ${Math.round(nextVol * 100)}%`);
    } catch (e) {
      ui?.setStatus(`volume: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const play = async (): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.play === 'function') {
        void clients.webApi.play({}).catch(() => {});
      }
      await clients.playback.play();
    } catch (e) {
      ui?.setStatus(`play: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pause = async (): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.pause === 'function') {
        void clients.webApi.pause().catch(() => {});
      }
      await clients.playback.pause();
    } catch (e) {
      ui?.setStatus(`pause: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const togglePlayPause = async (): Promise<void> => {
    const pb = getEffectivePlayback();
    if (pb?.state === 'playing') {
      await pause();
    } else {
      await play();
    }
  };

  const seek = async (positionMs: number): Promise<void> => {
    const ui = getUi();
    try {
      if (clients.webApi && typeof clients.webApi.seek === 'function') {
        void clients.webApi.seek(positionMs).catch(() => {});
      }
      await clients.playback.seek(positionMs);
      const secs = Math.floor(positionMs / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      ui?.setStatus(`Seek: ${mins}:${remSecs.toString().padStart(2, '0')}`);
    } catch (e) {
      ui?.setStatus(`seek: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    toggleShuffle,
    toggleRepeat,
    toggleAutoplay,
    seekRelative,
    changeVolume,
    play,
    pause,
    togglePlayPause,
    seek,
  };
}
