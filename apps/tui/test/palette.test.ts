import { describe, it, expect } from 'bun:test';
import { CommandPalette } from '../src/palette';

describe('CommandPalette', () => {
  it('starts inactive with empty filter', () => {
    const p = new CommandPalette();
    expect(p.isActive).toBe(false);
    expect(p.getFilter()).toBe('');
  });

  it('registers commands', () => {
    const p = new CommandPalette();
    p.register({ id: 'a', label: 'Action A', action: () => {} });
    p.register({ id: 'b', label: 'Action B', action: () => {} });
    expect(p.size()).toBe(2);
  });

  it('filters by label substring', () => {
    const p = new CommandPalette();
    p.register({ id: 'play', label: 'Play / Pause', action: () => {} });
    p.register({ id: 'lyrics', label: 'Open Lyrics', action: () => {} });
    p.open();
    p.setFilter('lyr');
    const matches = p.matches();
    expect(matches.length).toBe(1);
    expect(matches[0]?.id).toBe('lyrics');
  });

  it('matches keywords', () => {
    const p = new CommandPalette();
    p.register({ id: 'quit', label: 'Quit', action: () => {}, keywords: ['exit'] });
    p.open();
    p.setFilter('exit');
    expect(p.matches().length).toBe(1);
  });

  it('cycles selection with next/prev', () => {
    const p = new CommandPalette();
    p.register({ id: 'a', label: 'A', action: () => {} });
    p.register({ id: 'b', label: 'B', action: () => {} });
    p.register({ id: 'c', label: 'C', action: () => {} });
    p.open();
    expect(p.getSelectedIndex()).toBe(0);
    p.next();
    expect(p.getSelectedIndex()).toBe(1);
    p.next();
    p.next();
    expect(p.getSelectedIndex()).toBe(0);
    p.prev();
    expect(p.getSelectedIndex()).toBe(2);
  });

  it('execute returns selected command and closes palette', () => {
    const p = new CommandPalette();
    p.register({ id: 'a', label: 'A', action: () => {} });
    p.register({ id: 'b', label: 'B', action: () => {} });
    p.open();
    p.next();
    const cmd = p.execute();
    expect(cmd?.id).toBe('b');
    expect(p.isActive).toBe(false);
  });

  it('execute returns null when no matches', () => {
    const p = new CommandPalette();
    p.open();
    p.setFilter('xyz');
    expect(p.execute()).toBe(null);
  });
});
