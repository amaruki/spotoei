// Deterministic fixtures for `scripts/preview.ts`. Kept separate so both
// files stay under the 300 LoC ceiling.
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import type {
  CatalogAlbumT,
  CatalogArtistT,
  CatalogPlaylistT,
  CatalogTrackT,
  LyricsDocumentT,
  QueueSnapshotT,
} from 'spotoei-protocol';

import type { HomeRow, LibraryItemT, UiViewState } from '../src/ui';
import { APP_VERSION } from '../src/version';

export function artist(name: string, i: number): CatalogArtistT {
  return { id: `artist-${i}`, uri: `spotify:artist:${i}${i}${i}`, name };
}

export function track(
  id: string,
  name: string,
  artistNames: string[],
  durationMs: number,
  extra: Partial<CatalogTrackT> = {},
): CatalogTrackT {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artistNames.map((a, i) => artist(a, i + id.length)),
    durationMs,
    ...extra,
  };
}

export function album(id: string, name: string, artistName: string): CatalogAlbumT {
  return {
    id,
    uri: `spotify:album:${id}`,
    name,
    artists: [artist(artistName, id.length)],
    releaseDate: '2013-10-31',
    totalTracks: 13,
    albumType: 'album',
  };
}

export function playlist(id: string, name: string, owner: string): CatalogPlaylistT {
  return {
    id,
    uri: `spotify:playlist:${id}`,
    name,
    description: 'Synthwave, retro electro, and neon nights',
    owner: { id: `owner-${id}`, name: owner },
    trackCount: 42,
  };
}

export const NOW_PLAYING = track('nowplaying', 'Nightcall', ['Kavinsky'], 256_000, {
  albumId: 'outrun',
  albumName: 'OutRun',
});

// Playback wire shape (`PlaybackChangedDataT.track`) carries artist names only.
export function toWireTrack(source: CatalogTrackT) {
  return {
    uri: source.uri,
    name: source.name,
    artists: source.artists.map((a) => a.name),
    album: source.albumName,
    durationMs: source.durationMs,
  };
}

export function queueSnapshot(): QueueSnapshotT {
  return {
    current: NOW_PLAYING,
    upcoming: [
      'Midnight City — M83',
      'A Real Hero — College',
      'Turbo Killer — Carpenter Brut',
      'Resonance — HOME',
      'Sunset Lover — Petit Biscuit',
    ].map((label, i) => {
      const [name, artistName] = label.split(' — ');
      return {
        id: `queue-${i}`,
        track: track(`q${i}`, name!, [artistName!], 210_000 + i * 9_000),
        source: i < 3 ? ('context' as const) : ('autoplay' as const),
        addedAt: 1_700_000_000_000 + i,
      };
    }),
    revision: 7,
  };
}

export function baseState(): UiViewState {
  return {
    protocol: PROTOCOL_VERSION,
    playerVersion: APP_VERSION,
    capabilities: ['audio', 'visualizer', 'lyrics.synced', 'queue.mutation'],
    auth: {
      v: PROTOCOL_VERSION,
      state: 'authenticated',
      accountId: 'preview',
      scopes: ['user-top-read', 'user-library-read'],
      storage: 'keyring',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      authUrl: null,
    },
    playback: {
      revision: 12,
      observedAtMonotonicMs: 1_700_000_084_000,
      state: 'playing',
      track: toWireTrack(NOW_PLAYING),
      positionMs: 84_000,
      durationMs: 256_000,
      volume: 0.8,
      shuffle: true,
      repeat: 'context',
      autoplay: true,
    },
    queue: queueSnapshot(),
    visualizer: { mode: 'spectrum', fps: 60 },
    statusMessage: 'Shuffle on · Autoplay on',
  };
}

export function spectrumBands(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const envelope = Math.exp(-i / (count * 0.6));
    const wave =
      0.55 + 0.3 * Math.sin(i * 0.7) + 0.15 * Math.sin(i * 2.1 + 1.2) + 0.1 * Math.sin(i * 4.3);
    return Math.max(0.04, Math.min(1, envelope * wave + 0.15));
  });
}

const CREDITS = ['Disclosure', 'Daft Punk', 'Tycho', 'Bonobo', 'The Midnight'] as const;

export function homeRows(): HomeRow[] {
  const recent = [
    ['r1', 'Resonance', 'HOME', 213_000],
    ['r2', 'Genesis', 'Justice', 214_000],
    ['r3', 'Kerala', 'Bonobo', 234_000],
  ] as const;
  return [
    { kind: 'context', text: 'OutRun — Kavinsky' },
    { kind: 'header', text: 'Top Tracks' },
    { kind: 'track', track: track('t1', 'Nightcall', ['Kavinsky'], 256_000), saved: true },
    { kind: 'track', track: track('t2', 'Midnight City', ['M83'], 243_000) },
    { kind: 'track', track: track('t3', 'Resonance', ['HOME'], 213_000), saved: true },
    { kind: 'track', track: track('t4', 'Turbo Killer', ['Carpenter Brut'], 226_000) },
    { kind: 'track', track: track('t5', 'A Real Hero', ['College'], 268_000) },
    { kind: 'header', text: 'Top Artists' },
    ...CREDITS.slice(0, 4).map((name, i): HomeRow => ({
      kind: 'artist',
      artist: artist(name, 40 + i),
    })),
    { kind: 'header', text: 'Recently Played' },
    ...recent.map(([id, name, artistName, durationMs], i): HomeRow => ({
      kind: 'track',
      track: track(id, name, [artistName], durationMs),
      playedAt: new Date(1_700_000_000_000 - (i + 1) * 3_600_000).toISOString(),
    })),
    { kind: 'header', text: 'Discover · Synthwave' },
    { kind: 'discover', id: 'd1', label: 'Neon Nights', description: 'Playlist · 42 tracks' },
    { kind: 'discover', id: 'd2', label: 'Retro Electro', description: 'Mood · 80s synths' },
    { kind: 'discover', id: 'd3', label: 'Sunset Drive', description: 'Playlist · 60 tracks' },
    { kind: 'discover', id: 'd4', label: 'Chillwave', description: 'Genre · downtempo' },
  ];
}

export const LIBRARY_ITEMS: LibraryItemT[] = (
  [
    ['t1', 'Nightcall', 'Kavinsky', 'OutRun', 256_000],
    ['t2', 'Midnight City', 'M83', "Hurry Up, We're Dreaming", 243_000],
    ['t3', 'Resonance', 'HOME', 'Odyssey', 213_000],
    ['t4', 'A Real Hero', 'College', 'Drive OST', 268_000],
    ['t5', 'Turbo Killer', 'Carpenter Brut', 'Trilogy', 226_000],
    ['t6', 'Sunset Lover', 'Petit Biscuit', 'Presence', 238_000],
    ['t7', 'Teardrop', 'Massive Attack', 'Mezzanine', 330_000],
    ['t8', 'Genesis', 'Justice', 'Cross', 214_000],
    ['t9', 'Scanner', 'Clark', 'Death Peak', 301_000],
    ['t10', 'Kerala', 'Bonobo', 'Migration', 234_000],
    ['t11', 'Strobe', 'deadmau5', 'For Lack of a Better Name', 634_000],
    ['t12', 'Cirrus', 'Bonobo', 'The North Borders', 289_000],
  ] as Array<readonly [string, string, string, string, number]>
).map(([id, name, artistName, albumName, durationMs]) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [{ id: `ar-${id}`, name: artistName, uri: `spotify:artist:${id}` }],
  albumId: `al-${id}`,
  albumName,
  durationMs,
}));

const LYRICS_LINES = [
  'Out on the street, and I got no place to go',
  "I'm giving you a night call to tell you how I feel",
  'I want to drive you through the night, down the hills',
  "I'm gonna tell you something you don't want to hear",
  "I'm gonna show you where it's dark, but have no fear",
  "There's something inside you",
  "It's hard to explain",
  "They're talking about you, boy",
  'But you’re still the same',
  "There's something inside you",
  "It's hard to explain",
  "They're talking about you, boy",
  'But you’re still the same',
  "I'm giving you a night call to tell you how I feel",
  'I want to drive you through the night, down the hills',
  "I'm gonna tell you something you don't want to hear",
  "I'm gonna show you where it's dark, but have no fear",
  "There's something inside you",
  "It's hard to explain",
  "They're talking about you, boy",
  'But you’re still the same',
];

export const LYRICS: LyricsDocumentT = {
  kind: 'synced',
  language: 'en',
  lines: LYRICS_LINES.map((text, i) => ({ startMs: i * 11_000, text })),
};
