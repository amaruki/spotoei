import { describe, expect, it } from 'bun:test';
import { buildPlaybackBarContent } from '../src/ui/playbackBarView';

const base = {
  state: 'playing' as const,
  title: 'Creep',
  artist: 'Radiohead',
  album: 'Pablo Honey',
  positionMs: 84000,
  durationMs: 228000,
  shuffle: false,
  repeat: 'off' as const,
  queueCount: 12,
  volume: 68,
};

describe('playback bar responsive variants', () => {
  it('wide variant keeps state, title in line 1, progress in line 2, artist and album in line 3', () => {
    const out = buildPlaybackBarContent({ ...base, width: 120, hasCoverArt: true });
    expect(out.variant).toBe('wide');
    expect(out.line1).toContain('Creep');
    expect(out.line1).toContain('▶');
    expect(out.hasCoverArt).toBe(true);
    expect(out.line2).toContain('1:24');
    expect(out.line2).toContain('3:48');
    expect(out.line3).toContain('Radiohead');
    expect(out.line3).toContain('Pablo Honey');
  });

  it('renders clean layout without box when cover art is absent', () => {
    const out = buildPlaybackBarContent({ ...base, width: 120, hasCoverArt: false });
    expect(out.hasCoverArt).toBe(false);
    expect(out.line1).toContain('Creep');
    expect(out.line3).toContain('Radiohead');
  });

  it('medium variant keeps title and modes in line 1, progress in line 2, artist in line 3', () => {
    const out = buildPlaybackBarContent({ ...base, width: 100 });
    expect(out.variant).toBe('medium');
    expect(out.line1).toContain('Creep');
    expect(out.line1).toContain('Shuf');
    expect(out.line1).not.toContain('Pablo Honey');
    expect(out.line2).toContain('1:24');
    expect(out.line2).toContain('3:48');
    expect(out.line3).toContain('Radiohead');
  });

  it('narrow variant retains state, title and progress without album', () => {
    const out = buildPlaybackBarContent({ ...base, width: 50 });
    expect(out.variant).toBe('narrow');
    expect(out.line1).toContain('Creep');
    expect(out.line2).toContain('1:24 / 3:48');
    expect(out.line1).not.toContain('Pablo Honey');
    expect(out.line3).toContain('Radiohead');
  });
  it('never embeds genre in either variant', () => {
    const wide = buildPlaybackBarContent({ ...base, width: 120 });
    const narrow = buildPlaybackBarContent({ ...base, width: 40 });
    expect(wide.line1 + wide.line2).not.toContain('Genre');
    expect(narrow.line1 + narrow.line2).not.toContain('Genre');
  });

  it('idle state still shows state token and progress placeholders', () => {
    const out = buildPlaybackBarContent({
      ...base,
      state: 'idle',
      title: '',
      artist: '',
      width: 120,
    });
    expect(out.line1).toContain('■');
  });

  it('loading state renders the hourglass token without a play icon', () => {
    const out = buildPlaybackBarContent({ ...base, state: 'loading', width: 120 });
    expect(out.line1).toContain('⏳');
    expect(out.line1).not.toContain('▶');
    expect(out.line2).toContain('1:24');
  });
});
