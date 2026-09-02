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

export class LyricsClient {
  private child: ChildProcess;
  private timeoutMs: number;
  private listeners: Set<LyricsListener> = new Set();
  private pending = new Map<string, PendingRequest>();
  private lineListener: ((line: string) => void) | null = null;

  constructor(opts: LyricsClientOptions) {
    this.child = opts.child;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  start(): void {
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
              new Error(
                `${msg.error?.code ?? 'ERROR'}: ${msg.error?.message ?? 'unknown'}`,
              ),
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
    const id = crypto.randomUUID();
    const cmd = makeLyricsGet(id, trackUri);
    const line = JSON.stringify(cmd) + '\n';

    const { promise, resolve, reject } =
      Promise.withResolvers<LyricsDocumentT>();

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

    this.child.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });

    return promise;
  }
}

export function createLyricsClient(opts: LyricsClientOptions): LyricsClient {
  const client = new LyricsClient(opts);
  client.start();
  return client;
}
