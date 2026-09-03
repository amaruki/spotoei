import { describe, expect, test } from 'bun:test';
import { sanitize } from '../src/text';

describe('sanitize', () => {
  test('strips SGR CSI sequences', () => {
    expect(sanitize('\u001b[31mred\u001b[0m')).toBe('red');
  });

  test('strips OSC sequences terminated by BEL', () => {
    expect(sanitize('\u001b]0;evil-title\u0007normal')).toBe('normal');
  });

  test('strips OSC sequences terminated by ST (ESC \\)', () => {
    expect(sanitize('\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\text')).toBe(
      'linktext',
    );
  });

  test('strips 8-bit C1 control bytes', () => {
    expect(sanitize('safe\u0085text\u009f')).toBe('safetext');
  });

  test('replaces CR and LF with single space', () => {
    expect(sanitize('line1\r\nline2')).toBe('line1 line2');
  });

  test('strips cursor movement escapes', () => {
    expect(sanitize('\u001b[2Aup\u001b[Hhome')).toBe('uphome');
  });

  test('leaves printable CJK intact', () => {
    expect(sanitize('音楽')).toBe('音楽');
  });
});
