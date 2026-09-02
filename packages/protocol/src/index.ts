import { z } from 'zod';

// Stable protocol major version. Increment on breaking envelope/semantic changes.
export const PROTOCOL_VERSION = 1 as const;

// Wire-stable error codes (see TSD 06 §15).
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

// MVP command set (see TSD 06 §7).
export const COMMAND_NAMES = [
  'hello',
  'auth.status',
  'auth.begin',
  'auth.logout',
  'auth.get_web_token',
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

// MVP event set (subset used by M0; full set in TSD 06 §9+).
export const EVENT_NAMES = [
  'playback.changed',
  'playback.position',
  'queue.changed',
  'lyrics.synced',
  'lyrics.plain',
  'visualizer.spectrum',
  'visualizer.waveform',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

// Capabilities (see TSD 06 §5).
export const CAPABILITIES = [
  'lyrics.synced',
  'lyrics.plain',
  'visualizer.spectrum',
  'visualizer.waveform',
  'queue.mutation',
  'auth.single-token-session',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Top Items range enum (see TSD 11 §4.1).
export const TopItemsRange = z.enum(['short_term', 'medium_term', 'long_term']);
export type TopItemsRangeT = z.infer<typeof TopItemsRange>;

// Shared error detail shape.
export const ErrorDetail = z.object({
  code: z.enum([
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.AUTH_DENIED,
    ErrorCode.AUTH_FAILED,
    ErrorCode.API_UNAVAILABLE,
    ErrorCode.PLAYER_UNAVAILABLE,
    ErrorCode.PLAYBACK_FAILED,
    ErrorCode.AUDIO_DEVICE_UNAVAILABLE,
    ErrorCode.LYRICS_UNAVAILABLE,
    ErrorCode.INVALID_REQUEST,
    ErrorCode.UNSUPPORTED,
    ErrorCode.TIMEOUT,
    ErrorCode.INTERNAL,
  ]),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  detail: z.unknown().optional(),
});
export type ErrorDetailT = z.infer<typeof ErrorDetail>;

// Envelope base: every line carries protocol major version and a discriminator.
const envelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
};

// Command: TS -> Rust.
export const Command = z.object({
  ...envelopeBase,
  type: z.literal('command'),
  id: z.string().min(1),
  command: z.enum(COMMAND_NAMES),
  data: z.record(z.unknown()).default({}),
});
export type CommandT = z.infer<typeof Command>;

// Hello command data: client advertises supported protocols + UI version.
export const HelloData = z.object({
  protocols: z.array(z.number().int().min(1)).min(1),
  uiVersion: z.string().min(1),
});
export type HelloDataT = z.infer<typeof HelloData>;

// Response: Rust -> TS, echoes id.
export const Response = z.object({
  ...envelopeBase,
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.boolean(),
  data: z.record(z.unknown()).optional(),
  error: ErrorDetail.optional(),
});
export type ResponseT = z.infer<typeof Response>;

// Hello response data: server reports selected protocol + capabilities.
export const HelloResponseData = z.object({
  protocol: z.number().int().min(1),
  playerVersion: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
});
export type HelloResponseDataT = z.infer<typeof HelloResponseData>;

// Event: Rust -> TS, monotonic seq per process.
export const Event = z.object({
  ...envelopeBase,
  type: z.literal('event'),
  event: z.enum(EVENT_NAMES),
  seq: z.number().int().nonnegative(),
  data: z.record(z.unknown()).default({}),
});
export type EventT = z.infer<typeof Event>;

// Any inbound line (response or event). Commands flow TS->Rust only.
export const Inbound = z.discriminatedUnion('type', [Response, Event]);
export type InboundT = z.infer<typeof Inbound>;

// Line-level parse helper. Returns the parsed message or a tagged error.
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseInbound(line: string): ParseResult<InboundT> {
  if (line.length === 0) {
    return { ok: false, error: 'empty line' };
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

export function makeHello(id: string, uiVersion: string): CommandT {
  return {
    v: PROTOCOL_VERSION,
    type: 'command',
    id,
    command: 'hello',
    data: {
      protocols: [PROTOCOL_VERSION],
      uiVersion,
    },
  };
}

export function newRequestId(): string {
  // crypto.randomUUID is available in Bun and modern Node.
  return crypto.randomUUID();
}
