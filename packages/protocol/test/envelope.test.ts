import { describe, expect, test } from 'bun:test';
import { parseInbound, makeHello, PROTOCOL_VERSION } from '../src/index';
import { helloCommand, helloResponse } from '../fixtures/index';

describe('protocol envelope', () => {
  test('hello command has correct shape', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const msg = makeHello(id, 'spotoei-tui/0.0.0');
    expect(msg.v).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe('command');
    expect(msg.command).toBe('hello');
    expect(msg.data).toEqual({ protocols: [1], uiVersion: 'spotoei-tui/0.0.0' });
  });

  test('parseInbound accepts hello response', () => {
    const r = parseInbound(JSON.stringify(helloResponse));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('response');
      if (r.value.type === 'response') {
        expect(r.value.id).toBe(helloResponse.id);
        expect(r.value.ok).toBe(true);
      }
    }
  });

  test('parseInbound rejects empty line', () => {
    const r = parseInbound('');
    expect(r.ok).toBe(false);
  });

  test('parseInbound rejects malformed JSON', () => {
    const r = parseInbound('not json');
    expect(r.ok).toBe(false);
  });

  test('parseInbound rejects wrong protocol version', () => {
    const bad = { ...helloResponse, v: 99 };
    const r = parseInbound(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });

  test('hello command serializes roundtrip', () => {
    const line = JSON.stringify(helloCommand);
    const parsed = parseInbound(JSON.stringify(helloResponse));
    expect(typeof line).toBe('string');
    expect(parsed.ok).toBe(true);
  });
});
