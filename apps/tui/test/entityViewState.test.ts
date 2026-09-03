import { describe, expect, it } from 'bun:test';
import {
  createEntityView,
  nextArtistPageOffset,
  switchReleaseGroup,
} from '../src/entities/viewState';

describe('entity view state', () => {
  it('creates album view with selection restore defaults', () => {
    const v = createEntityView('album', 'alb1');
    expect(v.kind).toBe('album');
    expect(v.id).toBe('alb1');
    expect(v.selected).toBe(0);
    expect(v.scroll).toBe(0);
    expect(v.loadedPages).toEqual([]);
    expect(v.loading).toBe(false);
  });

  it('switches artist release group and resets paging', () => {
    let v = createEntityView('artist', 'art1');
    v = { ...v, selected: 5, scroll: 200, loadedPages: [0], nextOffset: 20 };
    const next = switchReleaseGroup(v, 'single');
    expect(next.releaseGroup).toBe('single');
    expect(next.selected).toBe(0);
    expect(next.scroll).toBe(0);
    expect(next.loadedPages).toEqual([]);
    expect(next.nextOffset).toBe(0);
  });

  it('computes next artist page offset only for one group at a time', () => {
    const v = createEntityView('artist', 'art1');
    expect(nextArtistPageOffset({ ...v, nextOffset: 20, hasMore: true })).toBe(20);
    expect(nextArtistPageOffset({ ...v, nextOffset: 20, hasMore: false })).toBeNull();
  });

  it('preserves per-entity selection keys independently', () => {
    const a = createEntityView('album', 'a1');
    const b = createEntityView('album', 'a2');
    expect(a.id).not.toBe(b.id);
    expect(a.selected).toBe(0);
    expect(b.selected).toBe(0);
  });
});
