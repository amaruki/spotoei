// Lyrics protocol types: domain model for synced and plain lyrics documents
// exchanged between the player (provider) and the TUI (consumer). Both sides
// parse against these schemas at their respective boundaries.

import { z } from 'zod';

// One line in a synced lyrics document. `startMs` is the time offset from
// track start at which this line becomes active.
export const TimedLyricLine = z.object({
  startMs: z.number().int().nonnegative().max(86_400_000),
  text: z.string().min(1).max(2_000),
});
export type TimedLyricLineT = z.infer<typeof TimedLyricLine>;

// One line in a plain (unsynced) lyrics document.
export const PlainLyricLine = z.object({
  text: z.string().min(1).max(2_000),
});
export type PlainLyricLineT = z.infer<typeof PlainLyricLine>;

// Full lyrics document payload, dispatched as either a `lyrics.synced` or
// `lyrics.plain` event by the player. Discriminated union keeps active-line
// computation cleanly conditional on `kind`.
export const LyricsDocument = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('synced'),
    language: z.string().min(2).max(16).optional(),
    lines: z.array(TimedLyricLine).min(1).max(2_000),
  }),
  z.object({
    kind: z.literal('plain'),
    language: z.string().min(2).max(16).optional(),
    lines: z.array(PlainLyricLine).min(1).max(2_000),
  }),
]);
export type LyricsDocumentT = z.infer<typeof LyricsDocument>;

// Command-side payload: ask the player to look up lyrics for a track.
export const LyricsGet = z.object({
  trackUri: z.string().min(1).max(512),
});
export type LyricsGetT = z.infer<typeof LyricsGet>;
