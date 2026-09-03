import { MAX_LINE_BYTES } from './constants';
import type { InboundT } from './schemas';
import { Inbound } from './schemas';

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

export function newRequestId(): string {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}
