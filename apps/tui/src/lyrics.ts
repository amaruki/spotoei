// Lyrics client: requests lyrics for a track and listens for synced/plain
// lyrics events from the player core.
//
// Clean Architecture: Operates strictly over NDJSON commands/events.

import type { ChildProcess } from 'node:child_process';
import { getSharedReadline } from './player';
import {
  LyricsDocument,
  makeLyricsGet,
  parseInbound,
  type LyricsDocumentT,
} from 'spotoei-protocol';

export interface LyricsClientOptions {
  child: ChildProcess;
  timeoutMs?: number;
}

export type LyricsListener = (document: LyricsDocumentT) => void;

interface PendingRequest {
  resolve: (value: LyricsDocumentT) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_PENDING = 32;

export class LyricsClient {
  private child: ChildProcess;
  private timeoutMs: number;
  private listeners: Set<LyricsListener> = new Set();
  private pending = new Map<string, PendingRequest>();
  private lineListener: ((line: string) => void) | null = null;
  private running = false;

  constructor(opts: LyricsClientOptions) {
    this.child = opts.child;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const rl = getSharedReadline(this.child);

    this.lineListener = (line: string): void => {
      const parsed = parseInbound(line);
      if (!parsed.ok) return;

      const msg = parsed.value;

      if (msg.type === 'response') {
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.id);
          if (msg.ok) {
            const parsedDoc = LyricsDocument.safeParse(msg.data);
            if (parsedDoc.success) {
              req.resolve(parsedDoc.data);
            } else {
              req.reject(new Error('INVALID_LYRICS_DOCUMENT'));
            }
          } else {
            req.reject(
              new Error(`${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`),
            );
          }
        }
        return;
      }

      if (msg.type === 'event') {
        if (msg.event === 'lyrics.synced' || msg.event === 'lyrics.plain') {
          const parsedDoc = LyricsDocument.safeParse(msg.data);
          if (parsedDoc.success) {
            for (const l of this.listeners) {
              try {
                l(parsedDoc.data);
              } catch {
                // Ignore listener exceptions
              }
            }
          }
        }
      }
    };

    rl.on('line', this.lineListener);
  }

  close(): void {
    this.running = false;
    if (this.lineListener) {
      const rl = getSharedReadline(this.child);
      rl.off('line', this.lineListener);
      this.lineListener = null;
    }
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('lyrics client closed'));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  subscribe(listener: LyricsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getLyrics(trackUri: string): Promise<LyricsDocumentT> {
    if (this.pending.size >= MAX_PENDING) {
      throw new Error(`lyrics pending queue full (${MAX_PENDING})`);
    }
    const id = crypto.randomUUID();
    const cmd = makeLyricsGet(id, trackUri);
    const line = JSON.stringify(cmd) + '\n';

    const { promise, resolve, reject } = Promise.withResolvers<LyricsDocumentT>();

    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`lyrics.get timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    this.pending.set(id, { resolve, reject, timer });

    if (!this.child.stdin || !this.child.stdin.writable) {
      clearTimeout(timer);
      this.pending.delete(id);
      reject(new Error('player stdin not writable'));
      return promise;
    }

    // Wait for the write to be drained to the OS pipe. A fast sidecar
    // reply can race the readline and time out if we don't synchronize
    // here. Errors reject so callers don't sit on a silent promise.
    await new Promise<void>((resolveWrite, rejectWrite) => {
      this.child.stdin!.write(line, (err) => (err ? rejectWrite(err) : resolveWrite()));
    }).catch((err: unknown) => {
      clearTimeout(timer);
      this.pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    return promise;
  }

  async loadLyrics(opts: FetchLyricsOptions): Promise<LyricsDocumentT> {
    // 1. Try public LRCLIB for real synced lyrics
    const fromLrc = await fetchLyricsFromLrclib(opts);
    if (fromLrc) {
      return fromLrc;
    }
    // 2. Fall back to sidecar player if track URI is present
    if (opts.trackUri) {
      return this.getLyrics(opts.trackUri);
    }
    throw new Error('No lyrics found for track');
  }
}

export interface FetchLyricsOptions {
  trackUri?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

export function parseLrc(lrcText: string): Array<{ startMs: number; text: string }> {
  const lines: Array<{ startMs: number; text: string }> = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  for (const rawLine of lrcText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = regex.exec(trimmed);
    if (match) {
      const mins = parseInt(match[1] ?? '0', 10);
      const secs = parseInt(match[2] ?? '0', 10);
      const msPart = match[3] ?? '0';
      const ms = msPart.length === 2 ? parseInt(msPart, 10) * 10 : parseInt(msPart, 10);
      const totalMs = mins * 60_000 + secs * 1000 + ms;
      const text = (match[4] ?? '').trim();
      if (text.length > 0) {
        lines.push({ startMs: totalMs, text });
      }
    }
  }
  return lines;
}

export async function fetchLyricsFromLrclib(opts: FetchLyricsOptions): Promise<LyricsDocumentT | null> {
  const title = opts.title?.trim();
  if (!title) return null;
  const artist = opts.artist?.trim() ?? '';
  const album = opts.album?.trim() ?? '';
  const durationSecs = opts.durationMs ? Math.round(opts.durationMs / 1000) : 0;

  try {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (album && album !== '—') {
      params.set('album_name', album);
    }
    if (durationSecs > 0) {
      params.set('duration', String(durationSecs));
    }

    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { 'User-Agent': 'Spotoei-TUI/0.1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // Fallback search
      const q = `${title} ${artist}`.trim();
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Spotoei-TUI/0.1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (searchRes.ok) {
        const hits = (await searchRes.json()) as Array<{ syncedLyrics?: string; plainLyrics?: string }>;
        if (Array.isArray(hits) && hits.length > 0) {
          const best = hits[0];
          if (best?.syncedLyrics) {
            const lines = parseLrc(best.syncedLyrics);
            if (lines.length > 0) return { kind: 'synced', lines };
          }
          if (best?.plainLyrics) {
            const raw = best.plainLyrics
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((text) => ({ text }));
            if (raw.length > 0) return { kind: 'plain', lines: raw };
          }
        }
      }
      return null;
    }

    const data = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
    if (data?.syncedLyrics) {
      const lines = parseLrc(data.syncedLyrics);
      if (lines.length > 0) return { kind: 'synced', lines };
    }
    if (data?.plainLyrics) {
      const raw = data.plainLyrics
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text }));
      if (raw.length > 0) return { kind: 'plain', lines: raw };
    }
    return null;
  } catch {
    return null;
  }
}

export function createLyricsClient(options: LyricsClientOptions): LyricsClient {
  const client = new LyricsClient(options);
  client.start();
  return client;
}
