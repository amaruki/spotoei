import { describe, expect, it } from 'bun:test';
import type { RouteT } from 'spotoei-protocol';

import {
  clearRouteStack,
  defaultRoute,
  popRoute,
  pushRoute,
  routeFromLegacy,
  ROUTE_STACK_LIMIT,
  sameRoute,
} from '../src/ui/core/navigationStack';

describe('pushRoute', () => {
  it('returns the same stack when current and next are equal', () => {
    const current: RouteT = { kind: 'home', tab: 'for_you' };
    const next: RouteT = { kind: 'home', tab: 'for_you' };
    const stack: RouteT[] = [];
    expect(pushRoute(stack, current, next)).toBe(stack);
  });

  it('appends current to the stack', () => {
    const stack: RouteT[] = [];
    const current: RouteT = { kind: 'home', tab: 'for_you' };
    const next: RouteT = { kind: 'search' };
    const result = pushRoute(stack, current, next);
    expect(result).toEqual([current]);
  });

  it('keeps the stack bounded to ROUTE_STACK_LIMIT', () => {
    let stack: RouteT[] = [];
    let current: RouteT = { kind: 'home', tab: 'for_you' };
    for (let i = 0; i < ROUTE_STACK_LIMIT + 10; i++) {
      const next: RouteT = { kind: 'search', query: `q${i}` };
      stack = pushRoute(stack, current, next);
      current = next;
    }
    expect(stack.length).toBeLessThanOrEqual(ROUTE_STACK_LIMIT);
  });
});

describe('popRoute', () => {
  it('returns empty popped when stack is empty', () => {
    const result = popRoute([]);
    expect(result.stack).toEqual([]);
    expect(result.popped).toBeNull();
  });

  it('pops the most recently pushed route', () => {
    const initial: RouteT = { kind: 'home', tab: 'for_you' };
    const stack = [initial];
    const result = popRoute(stack);
    expect(result.popped).toEqual(initial);
    expect(result.stack).toEqual([]);
  });
});

describe('clearRouteStack', () => {
  it('returns an empty array', () => {
    expect(clearRouteStack()).toEqual([]);
  });
});

describe('sameRoute', () => {
  it('returns true for routes with same kind and same kind-specific data', () => {
    expect(sameRoute({ kind: 'home', tab: 'for_you' }, { kind: 'home', tab: 'for_you' })).toBe(
      true,
    );
    expect(sameRoute({ kind: 'album', id: '1' }, { kind: 'album', id: '1' })).toBe(true);
  });

  it('returns false for routes of different kinds', () => {
    expect(sameRoute({ kind: 'home', tab: 'for_you' }, { kind: 'search' })).toBe(false);
  });

  it('returns false for same kind but different data', () => {
    expect(
      sameRoute({ kind: 'home', tab: 'for_you' }, { kind: 'home', tab: 'recently_played' }),
    ).toBe(false);
    expect(
      sameRoute(
        { kind: 'browse', path: { category: 'moods' } },
        { kind: 'browse', path: { category: 'genres' } },
      ),
    ).toBe(false);
    expect(
      sameRoute(
        { kind: 'browse', path: { category: 'moods' } },
        { kind: 'browse', path: { category: 'moods' } },
      ),
    ).toBe(true);
  });
});

describe('defaultRoute', () => {
  it('returns the home for_you route', () => {
    expect(defaultRoute()).toEqual({ kind: 'home', tab: 'for_you' });
  });
});

describe('routeFromLegacy', () => {
  it('passes through typed RouteT unchanged', () => {
    const route: RouteT = { kind: 'album', id: 'a1' };
    expect(routeFromLegacy(route)).toBe(route);
  });

  it('maps "home" string to home for_you route', () => {
    expect(routeFromLegacy('home')).toEqual({ kind: 'home', tab: 'for_you' });
  });

  it('maps "library" string to library saved_tracks route', () => {
    expect(routeFromLegacy('library')).toEqual({ kind: 'library', section: 'saved_tracks' });
  });

  it('maps "visualizer" string to visualizer route', () => {
    expect(routeFromLegacy('visualizer')).toEqual({ kind: 'visualizer' });
  });

  it('returns default route for unknown string', () => {
    expect(routeFromLegacy('mystery' as 'home')).toEqual({ kind: 'home', tab: 'for_you' });
  });
});
