import { describe, expect, it } from 'bun:test';
import { routePositionKey, ViewPositionStore } from '../src/navigation/viewPositions';

describe('view positions', () => {
  it('keys routes by serializable IDs only', () => {
    expect(routePositionKey({ kind: 'album', id: 'a1' })).toBe('album:a1');
    expect(routePositionKey({ kind: 'search', query: 'q' })).toBe('search:q');
    expect(routePositionKey({ kind: 'home', tab: 'for_you' })).toBe('home:for_you');
    expect(routePositionKey({ kind: 'browse', path: { category: 'm' } })).toBe('browse:m:');
  });

  it('restores saved selection and scroll per route', () => {
    const store = new ViewPositionStore();
    store.save({ kind: 'album', id: 'a1' }, { selected: 4, scroll: 120 });
    expect(store.restore({ kind: 'album', id: 'a1' })).toEqual({ selected: 4, scroll: 120 });
    expect(store.restore({ kind: 'album', id: 'a2' })).toEqual({ selected: 0, scroll: 0 });
  });

  it('keeps browse entry positions separate from category positions', () => {
    const store = new ViewPositionStore();
    store.save({ kind: 'browse', path: { category: 'moods' } }, { selected: 2, scroll: 0 });
    store.save(
      { kind: 'browse', path: { category: 'moods', entry: 'chill' } },
      { selected: 5, scroll: 40 },
    );
    expect(store.restore({ kind: 'browse', path: { category: 'moods' } }).selected).toBe(2);
    expect(
      store.restore({ kind: 'browse', path: { category: 'moods', entry: 'chill' } }).selected,
    ).toBe(5);
  });
});
