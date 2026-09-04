import { describe, expect, it } from 'bun:test';
import { resolveBackAction } from '../src/navigation/backBehavior';

describe('back behavior', () => {
  it('closes overlay or palette first', () => {
    expect(
      resolveBackAction({
        overlayOpen: true,
        route: { kind: 'album', id: 'a1' },
        browse: {},
      }),
    ).toBe('close_overlay');
    expect(
      resolveBackAction({
        paletteOpen: true,
        route: { kind: 'home', tab: 'for_you' },
        browse: {},
      }),
    ).toBe('close_overlay');
  });

  it('escapes browse results to entry list', () => {
    expect(
      resolveBackAction({
        route: { kind: 'browse', path: { category: 'moods', entry: 'chill' } },
        browse: {},
      }),
    ).toBe('browse_results_to_entries');
  });

  it('escapes browse entry list to category list', () => {
    expect(
      resolveBackAction({
        route: { kind: 'browse', path: { category: 'moods' } },
        browse: {},
      }),
    ).toBe('browse_entries_to_categories');
  });

  it('pops the route stack from the browse category list', () => {
    expect(
      resolveBackAction({
        route: { kind: 'browse', path: {} },
        browse: {},
        priorHomeTab: 'for_you',
      }),
    ).toBe('pop_route');
  });

  it('returns exact previous route for artist, album, playlist, lyrics, visualizer', () => {
    for (const route of [
      { kind: 'artist', id: 'a' },
      { kind: 'album', id: 'b' },
      { kind: 'playlist', id: 'p' },
      { kind: 'lyrics' },
      { kind: 'visualizer' },
    ] as const) {
      const action = resolveBackAction({ route, browse: {} });
      expect(action).toBe('pop_route');
    }
  });
});
