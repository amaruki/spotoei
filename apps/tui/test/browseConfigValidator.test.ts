import { describe, expect, it } from 'bun:test';

import { isValidBrowse } from '../src/browseConfigValidator';

describe('isValidBrowse', () => {
  it('returns false for non-object and null values', () => {
    expect(isValidBrowse(null)).toBe(false);
    expect(isValidBrowse(undefined)).toBe(false);
    expect(isValidBrowse(123)).toBe(false);
    expect(isValidBrowse('string')).toBe(false);
    expect(isValidBrowse(true)).toBe(false);
  });

  it('returns true for an empty object', () => {
    expect(isValidBrowse({})).toBe(true);
  });

  it('validates charts array with correct structure', () => {
    const valid = {
      charts: [
        {
          id: 'top50',
          label: 'Top 50',
          playlistUri: 'spotify:playlist:1',
          countryCode: 'US',
        },
      ],
    };
    expect(isValidBrowse(valid)).toBe(true);
  });

  it('rejects charts with invalid entry types', () => {
    expect(isValidBrowse({ charts: 'not-an-array' })).toBe(false);
    expect(isValidBrowse({ charts: [null] })).toBe(false);
    expect(isValidBrowse({ charts: [{ id: '' }] })).toBe(false);
    expect(isValidBrowse({ charts: [{ id: '1', label: 123 }] })).toBe(false);
    expect(isValidBrowse({ charts: [{ id: '1', label: 'L', playlistUri: 123 }] })).toBe(false);
    expect(
      isValidBrowse({
        charts: [{ id: '1', label: 'L', playlistUri: 'p', countryCode: 123 }],
      }),
    ).toBe(false);
  });

  it('validates editorial playlists array', () => {
    const valid = {
      editorialPlaylists: [
        { id: 'today', label: "Today's Hits", playlistUri: 'spotify:playlist:today' },
      ],
    };
    expect(isValidBrowse(valid)).toBe(true);
    expect(isValidBrowse({ editorialPlaylists: 'bad' })).toBe(false);
    expect(isValidBrowse({ editorialPlaylists: [{ id: '' }] })).toBe(false);
  });

  it('validates driving playlist URIs array of strings', () => {
    expect(isValidBrowse({ drivingPlaylistUris: ['spotify:playlist:drive'] })).toBe(true);
    expect(isValidBrowse({ drivingPlaylistUris: [123] })).toBe(false);
    expect(isValidBrowse({ drivingPlaylistUris: 'bad' })).toBe(false);
  });
});
