import { z } from 'zod';

export { PROTOCOL_VERSION } from './version';

// Hard cap on a single NDJSON line. Larger lines are rejected as INVALID_REQUEST
// on both sides (TUI reads, player reads). Prevents memory-exhaustion DoS via
// a single oversized line.
export const MAX_LINE_BYTES = 1 << 20; // 1 MiB

// Handshake deadline on the TS side. Must match the Rust HANDSHAKE_TIMEOUT.
export const HANDSHAKE_TIMEOUT_MS = 5_000;

// Shutdown grace. Player gets this long to exit cleanly after receiving
// the `shutdown` command before we force-kill it.
export const SHUTDOWN_TIMEOUT_MS = 2_000;

// Stable wire-level error codes. The set is closed; both sides (TS and Rust)
// must agree on every literal. Adding a new code here requires also wiring it
// into the Rust mirror (ErrorCode enum in crates/player/src/main.rs).
export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_DENIED: 'AUTH_DENIED',
  AUTH_FAILED: 'AUTH_FAILED',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  PLAYER_UNAVAILABLE: 'PLAYER_UNAVAILABLE',
  PLAYBACK_FAILED: 'PLAYBACK_FAILED',
  AUDIO_DEVICE_UNAVAILABLE: 'AUDIO_DEVICE_UNAVAILABLE',
  LYRICS_UNAVAILABLE: 'LYRICS_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNSUPPORTED: 'UNSUPPORTED',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCodeT = (typeof ErrorCode)[keyof typeof ErrorCode];

// All command names this protocol ever defines. Players must reject any
// command not on this list with INVALID_REQUEST. Adding a new command means
// extending the discriminated-union data schemas below.
export const COMMAND_NAMES = [
  'hello',
  'auth.status',
  'auth.begin',
  'auth.logout',
  'auth.get_web_token',
  'auth.invalidate_token',
  'auth.set_client_id',
  'playback.load',
  'playback.play',
  'playback.pause',
  'playback.toggle',
  'playback.next',
  'playback.previous',
  'playback.seek',
  'playback.seek_relative',
  'playback.set_volume',
  'playback.toggle_mute',
  'playback.set_shuffle',
  'playback.set_repeat',
  'playback.set_autoplay',
  'playback.get_audio_config',
  'playback.set_audio_config',
  'queue.get',
  'queue.add',
  'lyrics.get',
  'visualizer.configure',
  'player.status',
  'shutdown',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

// Events the player may push unprompted.
export const EVENT_NAMES = [
  'auth.changed',
  'auth.completed',
  'auth.failed',
  'playback.changed',
  'playback.position',
  'queue.changed',
  'lyrics.synced',
  'lyrics.plain',
  'visualizer.spectrum',
  'visualizer.waveform',
] as const;

// Per-event typed payloads. Discriminated by the event name so the
// inbound parser can reject malformed/wrong-type event bodies instead
// of silently accepting permissive `Record<string, unknown>` records.
import { AuthChangedEventData, AuthCompletedEventData, AuthFailedEventData } from './auth';
import { PlaybackChangedData, PlaybackPositionData } from './playback';
import { QueueSnapshot } from './catalog';
import { LyricsDocument } from './lyrics';
import { SpectrumFrame, WaveformFrame } from './visualizer';

export const EventDataByEvent = {
  'auth.changed': AuthChangedEventData,
  'auth.completed': AuthCompletedEventData,
  'auth.failed': AuthFailedEventData,
  'playback.changed': PlaybackChangedData,
  'playback.position': PlaybackPositionData,
  'queue.changed': QueueSnapshot,
  'lyrics.synced': LyricsDocument,
  'lyrics.plain': LyricsDocument,
  'visualizer.spectrum': SpectrumFrame,
  'visualizer.waveform': WaveformFrame,
} as const;
export type EventDataByEventT = typeof EventDataByEvent;

// Capabilities the player may advertise during hello. Empty array = none.
// The TUI must gate every capability-gated feature on `caps.includes(...)`
// and refuse to invoke the feature when absent.
export const CAPABILITIES = [
  'lyrics.synced',
  'lyrics.plain',
  'visualizer.spectrum',
  'visualizer.waveform',
  'queue.mutation',
  'auth.single-token-session',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Spotify's documented "top items" time ranges.
export const TopItemsRange = z.enum(['short_term', 'medium_term', 'long_term']);
export type TopItemsRangeT = z.infer<typeof TopItemsRange>;

// Helper used by schemas; build an ErrorCode zod enum from the closed const.
export const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCodeT, ...ErrorCodeT[]]);
