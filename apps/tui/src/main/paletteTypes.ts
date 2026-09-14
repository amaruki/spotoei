import type { PlayTrackOpts } from './playback';

export interface PaletteActionDeps {
  triggerAuth: () => Promise<void>;
  triggerLogout: () => Promise<void>;
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
