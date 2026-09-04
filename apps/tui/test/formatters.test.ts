import { describe, expect, it } from 'bun:test';
import type { RouteT } from 'spotoei-protocol';

import { authSummary, cap, formatArtists, formatTime, routeTitle } from '../src/ui/formatters';

describe('cap', () => {
  it('leaves short strings untouched', () => {
    expect(cap('hello', 10)).toBe('hello');
  });

  it('truncates longer strings with ellipsis', () => {
    expect(cap('hello world', 6)).toBe('hello…');
  });

  it('handles zero or 1 max correctly', () => {
    expect(cap('hello', 0)).toBe('');
    expect(cap('hello', 1)).toBe('h');
  });
});

describe('formatArtists', () => {
  it('returns dash for undefined or empty', () => {
    expect(formatArtists()).toBe('—');
    expect(formatArtists([])).toBe('—');
    expect(formatArtists(null)).toBe('—');
  });

  it('returns string input directly', () => {
    expect(formatArtists('Pink Floyd')).toBe('Pink Floyd');
  });

  it('joins array of strings', () => {
    expect(formatArtists(['Artist A', 'Artist B'])).toBe('Artist A, Artist B');
  });

  it('joins array of artist objects', () => {
    expect(formatArtists([{ name: 'Singer' }, { name: 'Band' }])).toBe('Singer, Band');
  });
});

describe('authSummary', () => {
  it('formats full auth state correctly', () => {
    const auth = {
      v: 1 as const,
      state: 'authenticated' as const,
      accountId: 'user123',
      scopes: [] as string[],
      storage: 'keyring' as const,
      accessTokenExpiresAt: 0 as number | null,
      authUrl: null as string | null,
    };
    expect(authSummary(auth)).toBe('authenticated • user123 • keyring');
  });

  it('uses no account fallback for missing accountId', () => {
    const auth = {
      v: 1 as const,
      state: 'authenticated' as const,
      accountId: null,
      scopes: [] as string[],
      storage: 'memory' as const,
      accessTokenExpiresAt: 0 as number | null,
      authUrl: null as string | null,
    };
    expect(authSummary(auth)).toBe('authenticated • no account • memory');
  });
});

describe('routeTitle', () => {
  it('formats typed routes', () => {
    expect(routeTitle({ kind: 'home', tab: 'for_you' } as RouteT)).toBe('Home');
    expect(routeTitle({ kind: 'search', query: 'jazz' } as RouteT)).toBe('Search');
    expect(routeTitle({ kind: 'album', id: '123' } as RouteT)).toBe('Album');
    expect(routeTitle({ kind: 'artist', id: '456' } as RouteT)).toBe('Artist');
    expect(routeTitle({ kind: 'playlist', id: '789' } as RouteT)).toBe('Playlist');
    expect(routeTitle({ kind: 'visualizer' } as RouteT)).toBe('Visualizer');
    expect(routeTitle({ kind: 'onboarding' } as RouteT)).toBe('Welcome');
  });
});

describe('formatTime', () => {
  it('formats zero and negative as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(-100)).toBe('0:00');
  });

  it('formats milliseconds to m:ss', () => {
    expect(formatTime(65_000)).toBe('1:05');
    expect(formatTime(210_000)).toBe('3:30');
    expect(formatTime(3600_000)).toBe('60:00');
  });
});
