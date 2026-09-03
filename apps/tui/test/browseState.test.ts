import { describe, expect, it } from 'bun:test';
import {
  browseLevel,
  createInitialBrowseState,
  enterCategory,
  enterEntry,
  escapeBrowse,
  restoreBrowseSelection,
  saveBrowseSelection,
} from '../src/browse/state';

describe('browse navigation state', () => {
  it('starts at category list with no path', () => {
    const s = createInitialBrowseState();
    expect(browseLevel(s.path)).toBe('categories');
  });

  it('enters category then entry then results', () => {
    let s = createInitialBrowseState();
    s = enterCategory(s, 'moods');
    expect(browseLevel(s.path)).toBe('entries');
    s = enterEntry(s, 'moods', 'chill');
    expect(browseLevel(s.path)).toBe('results');
  });

  it('escapes results to entry list, entry list to categories', () => {
    let s = createInitialBrowseState();
    s = enterCategory(s, 'moods');
    s = enterEntry(s, 'moods', 'chill');
    s = escapeBrowse(s);
    expect(s.path).toEqual({ category: 'moods' });
    s = escapeBrowse(s);
    expect(s.path).toEqual({});
    expect(browseLevel(s.path)).toBe('categories');
  });

  it('saves and restores selection and scroll per browse key', () => {
    let s = createInitialBrowseState();
    s = enterCategory(s, 'genres');
    s = saveBrowseSelection(s, 'genres', 3, 120);
    const restored = restoreBrowseSelection(s, 'genres');
    expect(restored.selected).toBe(3);
    expect(restored.scroll).toBe(120);
  });

  it('restores zero defaults for unknown keys', () => {
    const s = createInitialBrowseState();
    const restored = restoreBrowseSelection(s, 'unknown-cat');
    expect(restored.selected).toBe(0);
    expect(restored.scroll).toBe(0);
  });
});
