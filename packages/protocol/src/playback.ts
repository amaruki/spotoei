import { z } from 'zod';

export const PlaybackState = z.enum([
  'idle',
  'loading',
  'buffering',
  'playing',
  'paused',
  'reconnecting',
  'error',
]);
export type PlaybackStateT = z.infer<typeof PlaybackState>;

export const RepeatMode = z.enum(['off', 'context', 'track']);
export type RepeatModeT = z.infer<typeof RepeatMode>;

export const Track = z.object({
  uri: z.string().min(1),
  name: z.string().min(1),
  artists: z.array(z.string()),
  album: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
  genre: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type TrackT = z.infer<typeof Track>;

export const PlaybackChangedData = z.object({
  revision: z.number().int().nonnegative(),
  state: PlaybackState,
  track: Track.nullable().optional(),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  volume: z.number().min(0).max(1),
  shuffle: z.boolean(),
  repeat: RepeatMode,
  autoplay: z.boolean(),
  observedAtMonotonicMs: z.number().int().nonnegative(),
});
export type PlaybackChangedDataT = z.infer<typeof PlaybackChangedData>;

export const PlaybackPositionData = z.object({
  revision: z.number().int().nonnegative(),
  positionMs: z.number().int().nonnegative(),
});
export type PlaybackPositionDataT = z.infer<typeof PlaybackPositionData>;

export const PlaybackLoadData = z
  .object({
    contextUri: z.string().optional(),
    trackUri: z.string().optional(),
    autoplay: z.boolean().optional(),
    name: z.string().optional(),
    artists: z.array(z.string()).optional(),
    album: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    genre: z.string().optional(),
  })
  .refine((data) => Boolean(data.contextUri || data.trackUri), {
    message: 'At least one of contextUri or trackUri must be provided',
  });
export type PlaybackLoadDataT = z.infer<typeof PlaybackLoadData>;

export const PlaybackSeekData = z.object({
  positionMs: z.number().int().nonnegative(),
});
export type PlaybackSeekDataT = z.infer<typeof PlaybackSeekData>;

export const PlaybackSetVolumeData = z.object({
  volume: z.number().min(0).max(1),
});
export type PlaybackSetVolumeDataT = z.infer<typeof PlaybackSetVolumeData>;

export const PlaybackSetShuffleData = z.object({
  shuffle: z.boolean(),
});
export type PlaybackSetShuffleDataT = z.infer<typeof PlaybackSetShuffleData>;

export const PlaybackSetRepeatData = z.object({
  repeat: RepeatMode,
});
export type PlaybackSetRepeatDataT = z.infer<typeof PlaybackSetRepeatData>;

export const PlaybackSetAutoplayData = z.object({
  autoplay: z.boolean(),
});
export type PlaybackSetAutoplayDataT = z.infer<typeof PlaybackSetAutoplayData>;

export const PlaybackStatusData = PlaybackChangedData;
export type PlaybackStatusDataT = z.infer<typeof PlaybackStatusData>;
