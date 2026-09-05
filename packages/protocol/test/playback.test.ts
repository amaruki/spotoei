import { describe, expect, it } from 'bun:test';

import {
  PlaybackChangedData,
  PlaybackLoadData,
  PlaybackPositionData,
  PlaybackSetVolumeData,
  PlaybackState,
  RepeatMode,
  Track,
  makePlaybackLoad,
  makePlaybackNext,
  makePlaybackPause,
  makePlaybackPlay,
  makePlaybackPrevious,
  makePlaybackSeek,
  makePlaybackSeekRelative,
  makePlaybackSetAutoplay,
  makePlaybackSetRepeat,
  makePlaybackSetShuffle,
  makePlaybackSetVolume,
  makePlaybackStatus,
  makePlaybackToggleMute,
  makePlaybackToggle,
  makePlaybackGetAudioConfig,
  makePlaybackSetAudioConfig,
} from '../src';

describe('Protocol Playback Schemas', () => {
  it('parses valid PlaybackState enums', () => {
    const validStates = [
      'idle',
      'loading',
      'buffering',
      'playing',
      'paused',
      'reconnecting',
      'error',
    ];
    for (const state of validStates) {
      expect(PlaybackState.parse(state)).toBe(state);
    }
    expect(() => PlaybackState.parse('invalid_state')).toThrow();
  });

  it('parses valid RepeatMode enums', () => {
    const validModes = ['off', 'context', 'track'];
    for (const mode of validModes) {
      expect(RepeatMode.parse(mode)).toBe(mode);
    }
    expect(() => RepeatMode.parse('invalid_mode')).toThrow();
  });

  it('parses valid Track', () => {
    const validTrack = {
      uri: 'spotify:track:test1234',
      name: 'Sample Song',
      artists: ['Artist A', 'Artist B'],
      album: 'Sample Album',
      durationMs: 240000,
    };
    const parsed = Track.parse(validTrack);
    expect(parsed.name).toBe('Sample Song');
    expect(parsed.artists.length).toBe(2);
  });

  it('parses valid PlaybackChangedData', () => {
    const validEvent = {
      revision: 42,
      state: 'playing',
      track: {
        uri: 'spotify:track:test1234',
        name: 'Sample Song',
        artists: ['Artist A'],
        durationMs: 240000,
      },
      positionMs: 12000,
      durationMs: 240000,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
      autoplay: true,
      observedAtMonotonicMs: 50000,
    };
    const parsed = PlaybackChangedData.parse(validEvent);
    expect(parsed.state).toBe('playing');
    expect(parsed.track?.name).toBe('Sample Song');
  });

  it('parses valid PlaybackPositionData', () => {
    const pos = { revision: 12, positionMs: 45000 };
    const parsed = PlaybackPositionData.parse(pos);
    expect(parsed.positionMs).toBe(45000);
  });

  it('validates PlaybackLoadData requires at least one URI', () => {
    expect(() => PlaybackLoadData.parse({})).toThrow();
    expect(PlaybackLoadData.parse({ contextUri: 'spotify:album:abc' })).toBeDefined();
    expect(PlaybackLoadData.parse({ trackUri: 'spotify:track:abc' })).toBeDefined();
  });

  it('validates volume boundaries', () => {
    expect(PlaybackSetVolumeData.parse({ volume: 0.5 }).volume).toBe(0.5);
    expect(PlaybackSetVolumeData.parse({ volume: 1.0 }).volume).toBe(1.0);
    expect(PlaybackSetVolumeData.parse({ volume: 0.0 }).volume).toBe(0.0);
    expect(() => PlaybackSetVolumeData.parse({ volume: 1.2 })).toThrow();
    expect(() => PlaybackSetVolumeData.parse({ volume: -0.1 })).toThrow();
  });

  it('generates well-formed command envelopes with helpers', () => {
    const id = 'req-123';
    expect(makePlaybackPlay(id)).toMatchObject({
      command: 'playback.play',
      id,
    });
    expect(makePlaybackPause(id)).toMatchObject({
      command: 'playback.pause',
      id,
    });
    expect(makePlaybackToggle(id)).toMatchObject({
      command: 'playback.toggle',
      id,
    });
    expect(makePlaybackNext(id)).toMatchObject({
      command: 'playback.next',
      id,
    });
    expect(makePlaybackPrevious(id)).toMatchObject({
      command: 'playback.previous',
      id,
    });
    expect(makePlaybackSeek(id, 30000)).toMatchObject({
      command: 'playback.seek',
      data: { positionMs: 30000 },
    });
    expect(makePlaybackSetVolume(id, 0.75)).toMatchObject({
      command: 'playback.set_volume',
      data: { volume: 0.75 },
    });
    expect(makePlaybackSetShuffle(id, true)).toMatchObject({
      command: 'playback.set_shuffle',
      data: { shuffle: true },
    });
    expect(makePlaybackSetRepeat(id, 'track')).toMatchObject({
      command: 'playback.set_repeat',
      data: { repeat: 'track' },
    });
    expect(makePlaybackSetAutoplay(id, false)).toMatchObject({
      command: 'playback.set_autoplay',
      data: { autoplay: false },
    });
    expect(makePlaybackSeekRelative(id, 15000)).toMatchObject({
      command: 'playback.seek_relative',
      data: { offsetMs: 15000 },
      id,
    });
    expect(makePlaybackToggleMute(id)).toMatchObject({
      command: 'playback.toggle_mute',
      data: {},
      id,
    });
    expect(
      makePlaybackLoad(id, {
        trackUri: 'spotify:track:xyz',
        autoplay: true,
        name: 'Track Title',
        artists: ['Artist 1'],
        album: 'Album Title',
        durationMs: 384460,
        genre: 'Pop',
      }),
    ).toMatchObject({
      command: 'playback.load',
      data: {
        trackUri: 'spotify:track:xyz',
        autoplay: true,
        name: 'Track Title',
        artists: ['Artist 1'],
        album: 'Album Title',
        durationMs: 384460,
        genre: 'Pop',
      },
    });
    expect(makePlaybackStatus(id)).toMatchObject({
      command: 'player.status',
      id,
    });
    expect(makePlaybackGetAudioConfig(id)).toMatchObject({
      command: 'playback.get_audio_config',
      id,
    });
    expect(
      makePlaybackSetAudioConfig(id, {
        bitrate: '320',
        normalisation: true,
      }),
    ).toMatchObject({
      command: 'playback.set_audio_config',
      data: {
        bitrate: '320',
        normalisation: true,
      },
      id,
    });
  });
});
