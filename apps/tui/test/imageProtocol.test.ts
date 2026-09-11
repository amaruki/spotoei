import { afterEach, describe, expect, it } from 'bun:test';
import { resolveImageProtocol } from '../src/ui/imageProtocol';

const savedHerdr = process.env.HERDR_ENV;
const savedOverride = process.env.SPOTOEI_IMAGE_PROTOCOL;

afterEach(() => {
  if (savedHerdr === undefined) delete process.env.HERDR_ENV;
  else process.env.HERDR_ENV = savedHerdr;
  if (savedOverride === undefined) delete process.env.SPOTOEI_IMAGE_PROTOCOL;
  else process.env.SPOTOEI_IMAGE_PROTOCOL = savedOverride;
});

describe('resolveImageProtocol', () => {
  it('uses auto outside herdr so capable terminals keep graphics protocols', () => {
    delete process.env.HERDR_ENV;
    delete process.env.SPOTOEI_IMAGE_PROTOCOL;
    expect(resolveImageProtocol()).toBe('auto');
  });

  it('forces blocks under herdr, whose kitty advertisement is not renderable by every client', () => {
    process.env.HERDR_ENV = '1';
    delete process.env.SPOTOEI_IMAGE_PROTOCOL;
    expect(resolveImageProtocol()).toBe('blocks');
  });

  it('honors an explicit override, including auto under herdr', () => {
    process.env.HERDR_ENV = '1';
    process.env.SPOTOEI_IMAGE_PROTOCOL = 'kitty';
    expect(resolveImageProtocol()).toBe('kitty');
    process.env.SPOTOEI_IMAGE_PROTOCOL = 'auto';
    expect(resolveImageProtocol()).toBe('auto');
  });

  it('ignores invalid overrides', () => {
    delete process.env.HERDR_ENV;
    process.env.SPOTOEI_IMAGE_PROTOCOL = 'sixel-please';
    expect(resolveImageProtocol()).toBe('auto');
  });
});
