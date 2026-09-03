import { z } from 'zod';
import {
  CAPABILITIES,
  COMMAND_NAMES,
  ErrorCodeSchema,
  EventDataByEvent,
  PROTOCOL_VERSION,
} from './constants';

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
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('auth.changed'),
    data: EventDataByEvent['auth.changed'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('auth.completed'),
    data: EventDataByEvent['auth.completed'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('auth.failed'),
    data: EventDataByEvent['auth.failed'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('playback.changed'),
    data: EventDataByEvent['playback.changed'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('playback.position'),
    data: EventDataByEvent['playback.position'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('queue.changed'),
    data: EventDataByEvent['queue.changed'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('lyrics.synced'),
    data: EventDataByEvent['lyrics.synced'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('lyrics.plain'),
    data: EventDataByEvent['lyrics.plain'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('visualizer.spectrum'),
    data: EventDataByEvent['visualizer.spectrum'],
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('event'),
    seq: z.number().int().nonnegative(),
    event: z.literal('visualizer.waveform'),
    data: EventDataByEvent['visualizer.waveform'],
  }),
]);
export type EventT = z.infer<typeof Event>;

// Any inbound line (response or event). Commands flow TS -> Rust only.
export const Inbound = z.union([Response, Event]);
export type InboundT = z.infer<typeof Inbound>;
