import { describe, expect, it } from 'bun:test';
import { initialHomeTabs, setForYouError, setRecentError, switchHomeTab } from '../src/home/tabs';
import { browseResultsLabel, shouldFetchBrowseEntry } from '../src/browse/results';

describe('home tabs', () => {
  it('defaults to For You with medium term range', () => {
    expect(initialHomeTabs()).toEqual({ activeTab: 'for_you', range: 'medium_term' });
  });

  it('isolates For You and Recently Played errors per scope', () => {
    let s = initialHomeTabs();
    s = setForYouError(s, 'missing user-top-read');
    expect(s.forYouError).toBe('missing user-top-read');
    expect(s.recentError).toBeUndefined();
    s = setRecentError(s, 'missing user-read-recently-played');
    expect(s.forYouError).toBe('missing user-top-read');
    expect(s.recentError).toBe('missing user-read-recently-played');
    s = switchHomeTab(s, 'recently_played');
    expect(s.activeTab).toBe('recently_played');
  });
});

describe('browse results', () => {
  it('labels search-backed pages as catalog search results', () => {
    expect(
      browseResultsLabel({
        id: 'chill',
        label: 'Chill',
        description: 'd',
        enabled: true,
        source: { kind: 'search', query: 'chill', types: ['playlist'] },
      }),
    ).toBe('Catalog search results');
  });

  it('never fetches disabled or unconfigured entries', () => {
    expect(
      shouldFetchBrowseEntry({
        id: 'charts_unconfigured',
        label: 'No Charts',
        description: 'd',
        enabled: false,
        source: { kind: 'playlist', playlistUri: '' },
      }),
    ).toBe(false);
    expect(
      shouldFetchBrowseEntry({
        id: 'us',
        label: 'US',
        description: 'd',
        enabled: true,
        source: { kind: 'playlist', playlistUri: 'spotify:playlist:us' },
      }),
    ).toBe(true);
  });
});
