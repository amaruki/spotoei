import { describe, it, expect } from 'bun:test';
import { getLayoutTier, drawBox, renderStatusBar } from '../src/layout';

describe('layout tier classification', () => {
  it('detects wide tier for columns >= 120', () => {
    expect(getLayoutTier(120)).toBe('wide');
    expect(getLayoutTier(160)).toBe('wide');
  });

  it('detects medium tier for columns 80-119', () => {
    expect(getLayoutTier(80)).toBe('medium');
    expect(getLayoutTier(119)).toBe('medium');
  });

  it('detects narrow tier for columns < 80', () => {
    expect(getLayoutTier(79)).toBe('narrow');
    expect(getLayoutTier(40)).toBe('narrow');
  });
});

describe('drawBox', () => {
  it('draws a simple box with title', () => {
    const lines = drawBox(['hello', 'world'], { width: 20, title: 'test' });
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('test');
    expect(lines[1]).toContain('hello');
    expect(lines[2]).toContain('world');
  });

  it('uses double borders when focused', () => {
    const lines = drawBox(['item'], { width: 15, focused: true });
    expect(lines[0]).toContain('╔');
    expect(lines[lines.length - 1]).toContain('╚');
  });

  it('truncates lines that exceed inner width', () => {
    const lines = drawBox(['a very long line that should be truncated'], { width: 10 });
    expect(lines[1]?.length).toBe(10);
  });
});

describe('renderStatusBar', () => {
  it('renders status bar with route and hints', () => {
    const bar = renderStatusBar({ width: 80, route: 'home', playbackState: 'playing' });
    expect(bar).toContain('[HOME]');
    expect(bar).toContain('playing');
  });

  it('handles narrow terminals gracefully', () => {
    const bar = renderStatusBar({ width: 30, route: 'search' });
    expect(bar.length).toBeLessThanOrEqual(30);
  });
});
