import { makeCommand } from './factories';
import type { CommandT } from './schemas';

// Auth command factories
export function makeAuthStatus(id: string): CommandT {
  return makeCommand(id, 'auth.status', {});
}

export function makeAuthBegin(id: string, scopes?: string[]): CommandT {
  return makeCommand(id, 'auth.begin', scopes ? { scopes } : {});
}

export function makeAuthBeginStreaming(id: string): CommandT {
  return makeCommand(id, 'auth.begin_streaming', {});
}

export function makeAuthStreamingStatus(id: string): CommandT {
  return makeCommand(id, 'auth.streaming_status', {});
}
export function makeAuthLogout(id: string): CommandT {
  return makeCommand(id, 'auth.logout', {});
}

export function makeAuthGetWebToken(id: string): CommandT {
  return makeCommand(id, 'auth.get_web_token', {});
}

export function makeAuthInvalidateToken(id: string): CommandT {
  return makeCommand(id, 'auth.invalidate_token', {});
}

export function makeAuthSetClientId(id: string, clientId: string): CommandT {
  return makeCommand(id, 'auth.set_client_id', { clientId });
}

// Playback command factories
export function makePlaybackPlay(id: string): CommandT {
  return makeCommand(id, 'playback.play', {});
}

export function makePlaybackPause(id: string): CommandT {
  return makeCommand(id, 'playback.pause', {});
}

export function makePlaybackToggle(id: string): CommandT {
  return makeCommand(id, 'playback.toggle', {});
}

export function makePlaybackNext(id: string): CommandT {
  return makeCommand(id, 'playback.next', {});
}

export function makePlaybackPrevious(id: string): CommandT {
  return makeCommand(id, 'playback.previous', {});
}

export function makePlaybackSeek(id: string, positionMs: number): CommandT {
  return makeCommand(id, 'playback.seek', { positionMs });
}

export function makePlaybackSeekRelative(id: string, offsetMs: number): CommandT {
  return makeCommand(id, 'playback.seek_relative', { offsetMs });
}

export function makePlaybackSetVolume(id: string, volume: number): CommandT {
  return makeCommand(id, 'playback.set_volume', { volume });
}

export function makePlaybackToggleMute(id: string): CommandT {
  return makeCommand(id, 'playback.toggle_mute', {});
}
export function makePlaybackSetShuffle(id: string, shuffle: boolean): CommandT {
  return makeCommand(id, 'playback.set_shuffle', { shuffle });
}

export function makePlaybackSetRepeat(id: string, repeat: string): CommandT {
  return makeCommand(id, 'playback.set_repeat', { repeat });
}

export function makePlaybackSetAutoplay(id: string, autoplay: boolean): CommandT {
  return makeCommand(id, 'playback.set_autoplay', { autoplay });
}

export function makePlaybackLoad(
  id: string,
  opts: {
    contextUri?: string;
    trackUri?: string;
    queueUris?: string[];
    autoplay?: boolean;
    name?: string;
    artists?: string[];
    album?: string;
    durationMs?: number;
    genre?: string;
  } = {},
): CommandT {
  const data: Record<string, unknown> = {};
  if (opts.contextUri !== undefined) data.contextUri = opts.contextUri;
  if (opts.trackUri !== undefined) data.trackUri = opts.trackUri;
  if (opts.queueUris !== undefined) data.queueUris = opts.queueUris;
  if (opts.autoplay !== undefined) data.autoplay = opts.autoplay;
  if (opts.name !== undefined) data.name = opts.name;
  if (opts.artists !== undefined) data.artists = opts.artists;
  if (opts.album !== undefined) data.album = opts.album;
  if (opts.durationMs !== undefined) data.durationMs = opts.durationMs;
  if (opts.genre !== undefined) data.genre = opts.genre;
  return makeCommand(id, 'playback.load', data);
}

export function makePlaybackStatus(id: string): CommandT {
  return makeCommand(id, 'player.status', {});
}

export interface AudioConfigOptions {
  deviceMode?: string;
  audioBackend?: string;
  bitrate?: string | number;
  crossfadeDurationMs?: number;
  normalisation?: boolean;
  normalisationType?: string;
  pregain?: number;
}

export function makePlaybackGetAudioConfig(id: string): CommandT {
  return makeCommand(id, 'playback.get_audio_config', {});
}

export function makePlaybackSetAudioConfig(id: string, config: AudioConfigOptions = {}): CommandT {
  return makeCommand(id, 'playback.set_audio_config', config as Record<string, unknown>);
}

// Lyrics command factories
export function makeLyricsGet(id: string, trackUri: string): CommandT {
  return makeCommand(id, 'lyrics.get', { trackUri });
}

// Visualizer command factories
export function makeVisualizerConfigure(
  id: string,
  config: {
    enabled?: boolean;
    mode?: 'spectrum' | 'winamp' | 'oscilloscope' | 'off';
    fps?: number;
    bands?: number;
    waveformSamples?: number;
  } = {},
): CommandT {
  return makeCommand(id, 'visualizer.configure', config);
}
