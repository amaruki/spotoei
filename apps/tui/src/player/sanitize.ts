import { ANSI_REGEX } from './types';

export function sanitizeStderr(chunk: Buffer): string {
  return chunk.toString('utf8').replace(ANSI_REGEX, '');
}
