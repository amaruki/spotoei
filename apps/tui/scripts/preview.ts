// Generates the README preview images from the real TUI component tree.
//
//   bun run apps/tui/scripts/preview.ts
//
// Each scene builds the same `createUiCore` used by the app inside a headless
// test renderer, applies deterministic fixture state, and captures the frame
// spans into docs/assets/*.svg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestRenderer } from '@opentui/core/testing';
import type { MockInput } from '@opentui/core/testing';

import { createUiCore, type Ui, type UiOptions, type UiViewState } from '../src/ui';
import { frameToSvg } from './previewSvg';
import {
  album,
  artist,
  baseState,
  homeRows,
  LIBRARY_ITEMS,
  LYRICS,
  playlist,
  queueSnapshot,
  spectrumBands,
  track,
} from './previewData';

const WIDTH = 120;
const HEIGHT = 36;
const OUT_DIR = join(import.meta.dir, '..', '..', '..', 'docs', 'assets');

function options(): UiOptions {
  return {
    onKey: () => {},
    onSearchSubmit: () => {},
    onSelectLibrary: () => {},
    onSelectQueue: () => {},
  };
}

async function shoot(
  name: string,
  title: string,
  setup: (ui: Ui, input: MockInput) => void | Promise<void>,
  state: UiViewState = baseState(),
): Promise<void> {
  const { renderer, renderOnce, captureSpans, mockInput } = await createTestRenderer({
    width: WIDTH,
    height: HEIGHT,
  });
  const ui = createUiCore(renderer, { ...state, queue: queueSnapshot() }, options());
  try {
    await setup(ui, mockInput);
    await renderOnce();
    await renderOnce();
    writeFileSync(join(OUT_DIR, `${name}.svg`), frameToSvg(captureSpans(), title));
    console.log(`preview: docs/assets/${name}.svg`);
  } finally {
    renderer.destroy();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  await shoot('home', 'spotoei — home', (ui) => {
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setFocus('main');
    ui.setHomeItems(homeRows(), { rangeLabel: 'Last 6 months' });
    ui.setVisualizerFrame({
      mode: 'spectrum',
      bands: spectrumBands(24),
      fps: 60,
      rms: 0.42,
      peak: 0.91,
    });
  });

  await shoot('search', 'spotoei — search', async (ui, input) => {
    ui.setRoute({ kind: 'search' });
    ui.setFocus('main');
    await input.typeText('nightcall', 1);
    ui.setSearchFilter('all');
    ui.setSearchResults('nightcall', {
      query: 'nightcall',
      hits: [
        { type: 'track', track: track('s1', 'Nightcall', ['Kavinsky'], 256_000) },
        { type: 'track', track: track('s2', 'Nightcall (Robotaki Remix)', ['Kavinsky'], 274_000) },
        { type: 'artist', artist: artist('Kavinsky', 70) },
        { type: 'artist', artist: artist('College', 71) },
        { type: 'album', album: album('a1', 'OutRun', 'Kavinsky') },
        { type: 'playlist', playlist: playlist('p1', 'Neon Nights', 'amaruki') },
        { type: 'playlist', playlist: playlist('p2', 'Drive OST Essentials', 'amaruki') },
      ],
    });
    ui.setVisualizerFrame({ mode: 'spectrum', bands: spectrumBands(20), fps: 30 });
  });

  await shoot('library', 'spotoei — library', (ui) => {
    ui.setRoute({ kind: 'library', section: 'saved_tracks' });
    ui.setFocus('main');
    ui.setLibraryItems(LIBRARY_ITEMS, undefined, { hasMore: false });
    ui.setVisualizerFrame({ mode: 'spectrum', bands: spectrumBands(20), fps: 30 });
  });

  await shoot('queue', 'spotoei — queue', (ui) => {
    ui.setRoute({ kind: 'queue' });
    ui.setFocus('main');
    ui.setQueueSnapshot(queueSnapshot());
  });

  await shoot('lyrics', 'spotoei — lyrics', (ui) => {
    ui.setRoute({ kind: 'lyrics' });
    ui.setFocus('main');
    ui.setLyrics(LYRICS);
    ui.setPlayback({ ...baseState().playback!, positionMs: 38_000 });
  });

  await shoot('visualizer', 'spotoei — visualizer', (ui) => {
    ui.setRoute({ kind: 'visualizer' });
    ui.setFocus('main');
    ui.setVisualizerFrame({
      mode: 'spectrum',
      bands: spectrumBands(64),
      maxBands: spectrumBands(64).map((v) => Math.min(1, v + 0.12)),
      rms: 0.46,
      peak: 0.93,
      fps: 60,
    });
    ui.setPlayback({ ...baseState().playback!, positionMs: 42_000 });
  });

  await shoot('palette', 'spotoei — command palette', (ui) => {
    ui.setRoute({ kind: 'home', tab: 'for_you' });
    ui.setFocus('main');
    ui.setHomeItems(homeRows(), { rangeLabel: 'Last 6 months' });
    ui.setPaletteCommands(
      [
        ['Home View', 'Esc'],
        ['Browse', 'b'],
        ['Search', '/'],
        ['Library: Playlists', 'saved playlists'],
        ['Queue', 'u'],
        ['Toggle Lyrics View', 'l'],
        ['Cycle Visualizer Mode', 'v'],
        ['Switch Playback Device…', 'transfer playback'],
        ['Toggle Private Session', 'hide listening activity'],
        ['Quit Spotoei', 'q / Ctrl-C'],
      ].map(([name, description]) => ({
        name: name!,
        description: description!,
        action: () => {},
      })),
    );
    ui.openPalette();
  });
}

await main();
