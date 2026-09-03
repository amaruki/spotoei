import { z } from 'zod';

import { PROTOCOL_VERSION } from './version';

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
  'auth.set_client_id',
  'playback.load',
  'playback.play',
  'playback.pause',
  'playback.toggle',
  'playback.next',
  'playback.previous',
  'playback.seek',
  'playback.set_volume',
  'playback.set_shuffle',
  'playback.set_repeat',
  'playback.set_autoplay',
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
import {
  PlaybackChangedData,
  PlaybackPositionData,
} from './playback';
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

// Shared error detail shape. `code` is sourced from the ErrorCode const above
// so the set cannot drift between the const and the schema.
const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCodeT, ...ErrorCodeT[]]);

export const ErrorDetail = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  detail: z.unknown().optional(),
});
export type ErrorDetailT = z.infer<typeof ErrorDetail>;

// Common envelope base. Every line on the wire carries the protocol major
// version and a type discriminator.
const envelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
};

// Per-command data schemas. M0 only nails down `hello`; the other commands
// fall through to the opaque catch-all. As each milestone lands, replace the
// catch-all with a typed branch of the discriminated union.
const HelloDataSchema = z.object({
  protocols: z.array(z.number().int().min(1)).min(1).max(16),
  uiVersion: z.string().min(1).max(64),
});
export type HelloDataT = z.infer<typeof HelloDataSchema>;

const CommandDataSchema = z.union([HelloDataSchema, z.record(z.unknown())]);
export type CommandDataT = z.infer<typeof CommandDataSchema>;

export const Command = z.object({
  ...envelopeBase,
  type: z.literal('command'),
  id: z.string().min(1),
  command: z.enum(COMMAND_NAMES),
  data: CommandDataSchema.default({}),
});
export type CommandT = z.infer<typeof Command>;

// Hello response data: the player tells the UI which protocol it selected
// and which capabilities it can serve.
export const HelloResponseData = z.object({
  protocol: z.number().int().min(1),
  playerVersion: z.string().min(1).max(64),
  capabilities: z.array(z.enum(CAPABILITIES)),
});
export type HelloResponseDataT = z.infer<typeof HelloResponseData>;

export const Response = z.object({
  ...envelopeBase,
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.boolean(),
  data: z.record(z.unknown()).optional(),
  error: ErrorDetail.optional(),
});
export type ResponseT = z.infer<typeof Response>;

// A response shape specifically for the hello reply. Use this schema at the
// boundary in place of the open Response + hand-rolled cast.
export const HelloResponse = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('response'),
    id: z.string().min(1),
    ok: z.boolean(),
    data: HelloResponseData,
  })
  .refine((r) => r.ok === true, {
    message: 'hello response must be ok=true',
  });
export type HelloResponseT = z.infer<typeof HelloResponse>;
// Typed event envelope. Each event name maps to its own data schema; the
// union is exhaustive over EVENT_NAMES so a new event without a schema
// is a compile-time error.
export const Event = z.discriminatedUnion('event', [
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('auth.changed'), data: EventDataByEvent['auth.changed'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('auth.completed'), data: EventDataByEvent['auth.completed'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('auth.failed'), data: EventDataByEvent['auth.failed'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('playback.changed'), data: EventDataByEvent['playback.changed'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('playback.position'), data: EventDataByEvent['playback.position'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('queue.changed'), data: EventDataByEvent['queue.changed'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('lyrics.synced'), data: EventDataByEvent['lyrics.synced'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('lyrics.plain'), data: EventDataByEvent['lyrics.plain'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('visualizer.spectrum'), data: EventDataByEvent['visualizer.spectrum'] }),
  z.object({ ...envelopeBase, type: z.literal('event'), seq: z.number().int().nonnegative(), event: z.literal('visualizer.waveform'), data: EventDataByEvent['visualizer.waveform'] }),
]);
export type EventT = z.infer<typeof Event>;

// Any inbound line (response or event). Commands flow TS -> Rust only.
export const Inbound = z.union([Response, Event]);
export type InboundT = z.infer<typeof Inbound>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Parse a single NDJSON line. Empty lines and malformed JSON are tagged errors
// with no thrown exceptions so the caller can route them through normal flow.
export function parseInbound(line: string): ParseResult<InboundT> {
  if (line.length === 0) {
    return { ok: false, error: 'empty line' };
  }
  if (line.length > MAX_LINE_BYTES) {
    return { ok: false, error: `line exceeds ${MAX_LINE_BYTES} bytes` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  const r = Inbound.safeParse(raw);
  if (!r.success) {
    return { ok: false, error: r.error.message };
  }
  return { ok: true, value: r.data };
}

// Constructors for the wire envelope. Use these instead of hand-rolling the
// object literal so the schema is the single source of truth.
export function makeCommand(
  id: string,
  command: CommandName,
  data: Record<string, unknown> = {},
): CommandT {
  return {
    v: PROTOCOL_VERSION,
    type: 'command',
    id,
    command,
    data,
  };
}

export function makeHello(id: string, uiVersion: string): CommandT {
  return makeCommand(id, 'hello', { protocols: [PROTOCOL_VERSION], uiVersion });
}

export function makeShutdown(id: string): CommandT {
  return makeCommand(id, 'shutdown', {});
}
export function newRequestId(): string {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}
export * from './auth';

export function makeAuthStatus(id: string): CommandT {
  return makeCommand(id, 'auth.status', {});
}

export function makeAuthBegin(id: string, scopes?: string[]): CommandT {
  return makeCommand(id, 'auth.begin', scopes ? { scopes } : {});
}

export function makeAuthLogout(id: string): CommandT {
  return makeCommand(id, 'auth.logout', {});
}

export function makeAuthGetWebToken(id: string): CommandT {
  return makeCommand(id, 'auth.get_web_token', {});
}

export function makeAuthSetClientId(id: string, clientId: string): CommandT {
  return makeCommand(id, 'auth.set_client_id', { clientId });
}

export * from './playback';

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

export function makePlaybackSetVolume(id: string, volume: number): CommandT {
  return makeCommand(id, 'playback.set_volume', { volume });
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

export * from './catalog';
export * from './visualizer';
export * from './lyrics';

export function makeLyricsGet(id: string, trackUri: string): CommandT {
  return makeCommand(id, 'lyrics.get', { trackUri });
}

export function makeVisualizerConfigure(
  id: string,
  config: {
    enabled?: boolean;
    mode?: 'spectrum' | 'winamp' | 'oscilloscope';
    fps?: number;
    bands?: number;
    waveformSamples?: number;
  } = {},
): CommandT {
  return makeCommand(id, 'visualizer.configure', config);
}
