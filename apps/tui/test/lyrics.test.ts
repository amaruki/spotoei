// Unit tests for the LyricsClient: validates event subscription, response
// resolution, error code mapping, and lifecycle.

import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { LyricsClient, parseLrc } from '../src/lyrics';
import { PROTOCOL_VERSION, type LyricsDocumentT } from 'spotoei-protocol';

const writeImpl = (_chunk: unknown, cb?: (err: null | Error) => void): boolean => {
  if (typeof cb === 'function') cb(null);
  return true;
};

function makeMockChild(): {
  child: ChildProcess;
  stdout: PassThrough;
  stdin: PassThrough;
} {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  (stdin as unknown as { write: typeof writeImpl }).write = writeImpl;
  const child = {
    stdout,
    stdin,
    exitCode: null,
    kill: () => true,
    once: () => child,
    on: () => child,
  } as unknown as ChildProcess;
  return { child, stdout, stdin };
}

function syncedResponse(id: string): string {
  return (
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'response',
      id,
      ok: true,
      data: {
        kind: 'synced',
        language: 'en',
        lines: [
          { startMs: 0, text: 'First' },
          { startMs: 2000, text: 'Second' },
        ],
      },
    }) + '\n'
  );
}

function plainResponse(id: string): string {
  return (
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'response',
      id,
      ok: true,
      data: {
        kind: 'plain',
        lines: [{ text: 'one' }, { text: 'two' }],
      },
    }) + '\n'
  );
}

function unavailableErrResponse(id: string): string {
  return (
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'response',
      id,
      ok: false,
      error: { code: 'LYRICS_UNAVAILABLE', message: 'no lyrics' },
    }) + '\n'
  );
}

function interceptWriteAndRespond(
  child: ChildProcess,
  stdout: PassThrough,
  makeResponse: (id: string) => string,
): void {
  (
    child.stdin as unknown as {
      write: (c: string, cb?: (err: null | Error) => void) => boolean;
    }
  ).write = ((chunk: string, cb?: (err: null | Error) => void): boolean => {
    if (typeof chunk === 'string' && chunk.includes('"lyrics.get"')) {
      const parsed = JSON.parse(chunk) as { id: string };
      queueMicrotask(() => stdout.write(makeResponse(parsed.id)));
    }
    if (typeof cb === 'function') cb(null);
    return true;
  }) as never;
}

describe('LyricsClient unit tests', () => {
  test('getLyrics resolves on synced response', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();
    interceptWriteAndRespond(child, stdout, syncedResponse);

    const doc: LyricsDocumentT = await client.getLyrics('spotify:track:test1234');
    expect(doc.kind).toBe('synced');
    if (doc.kind === 'synced') {
      expect(doc.lines.length).toBe(2);
    }
    client.close();
  });

  test('getLyrics resolves on plain response', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();
    interceptWriteAndRespond(child, stdout, plainResponse);

    const doc: LyricsDocumentT = await client.getLyrics('spotify:track:test_plain');
    expect(doc.kind).toBe('plain');
    if (doc.kind === 'plain') {
      expect(doc.lines.length).toBe(2);
    }
    client.close();
  });

  test('getLyrics rejects on LYRICS_UNAVAILABLE', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();
    interceptWriteAndRespond(child, stdout, unavailableErrResponse);

    await expect(client.getLyrics('spotify:track:test_unavailable')).rejects.toThrow(
      /LYRICS_UNAVAILABLE/,
    );
    client.close();
  });

  test('subscribe receives synced events', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();

    const docs: LyricsDocumentT[] = [];
    client.subscribe((doc) => {
      docs.push(doc);
    });

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'lyrics.synced',
        seq: 1,
        data: {
          kind: 'synced',
          lines: [{ startMs: 0, text: 'line1' }],
        },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(docs.length).toBe(1);
    expect(docs[0]!.kind).toBe('synced');
    client.close();
  });

  test('subscribe receives plain events', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();

    const docs: LyricsDocumentT[] = [];
    client.subscribe((doc) => {
      docs.push(doc);
    });

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'lyrics.plain',
        seq: 1,
        data: {
          kind: 'plain',
          lines: [{ text: 'one' }],
        },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(docs.length).toBe(1);
    expect(docs[0]!.kind).toBe('plain');
    client.close();
  });

  test('subscribe filters malformed event', async () => {
    const { child, stdout } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();

    const docs: LyricsDocumentT[] = [];
    client.subscribe((doc) => {
      docs.push(doc);
    });

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'lyrics.synced',
        seq: 1,
        data: { kind: 'broken', lines: 'not-an-array' },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(docs.length).toBe(0);
    client.close();
  });

  test('close() rejects pending getLyrics calls', async () => {
    const { child } = makeMockChild();
    const client = new LyricsClient({ child });
    client.start();

    const promise = client.getLyrics('spotify:track:pending');
    client.close();
    await expect(promise).rejects.toThrow(/lyrics client closed/);
  });

  test('parseLrc parses standard LRC timestamped lines into TimedLyricLines', () => {
    const lrc = `[00:01.50] Hello world\n[01:05.20] Second line\n[invalid] Skipped line`;
    const parsed = parseLrc(lrc);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({ startMs: 1500, text: 'Hello world' });
    expect(parsed[1]).toEqual({ startMs: 65200, text: 'Second line' });
  });

  test('loadLyrics falls back to getLyrics when external fetch yields no lyrics', async () => {
    const { child, stdout } = makeMockChild();
    interceptWriteAndRespond(child, stdout, syncedResponse);
    const client = new LyricsClient({ child });
    client.start();

    const doc = await client.loadLyrics({ trackUri: 'spotify:track:123', title: '' });
    expect(doc.kind).toBe('synced');
    client.close();
  });
});
