import { PlaybackChangedData, type PlaybackChangedDataT } from 'spotoei-protocol';

export const validatePlaybackChanged = (data: unknown) => {
  const result = PlaybackChangedData.safeParse(data);
  return result.success
    ? { ok: true as const, value: result.data }
    : {
        ok: false as const,
        error: new Error(`invalid playback state: ${result.error.message}`),
      };
};

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export type Validator<T> = (data: unknown) => ValidateResult<T>;

export const validatePlaybackChangedT: Validator<PlaybackChangedDataT> = (data) =>
  validatePlaybackChanged(data) as ValidateResult<PlaybackChangedDataT>;
