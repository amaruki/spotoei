import { describe, expect, it } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { PROTOCOL_VERSION } from 'spotoei-protocol';
import { createUiCore, type UiViewState } from '../src/ui';

const baseState: UiViewState = {
  protocol: 1,
  playerVersion: '0.1.0',
  capabilities: ['audio'],
  auth: {
    v: PROTOCOL_VERSION,
    state: 'authenticated',
    accountId: 'u',
    scopes: [],
    storage: 'keyring',
    accessTokenExpiresAt: Date.now() + 3600_000,
    authUrl: null,
  },
  playback: null,
  queue: { current: null, upcoming: [], revision: 0 },
  visualizer: { mode: 'spectrum', fps: 30 },
};

interface TreeNode {
  id?: string;
  visible?: boolean;
  width?: number;
  height?: number;
  image?: unknown;
  loading?: boolean;
  loadError?: unknown;
  getChildren?: () => TreeNode[];
}

function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const child of root.getChildren?.() ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

// 1x1 transparent PNG. Loading is async, so the test waits for the renderable
// to swap in the decoded image.
const COVER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('playback bar cover art', () => {
  it('renders a recognizable image, not a one-row strip', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = createUiCore(renderer, baseState, {
      onKey: () => {},
      onSearchSubmit: () => {},
      onSelectLibrary: () => {},
      onSelectQueue: () => {},
    });

    ui.setPlayback({
      revision: 2,
      state: 'playing',
      track: {
        uri: 'spotify:track:cover',
        name: 'Cover Track',
        artists: ['Artist'],
        durationMs: 180000,
        imageUrl: COVER_PNG,
      },
      positionMs: 0,
      durationMs: 180000,
      volume: 1,
      shuffle: false,
      repeat: 'off',
      autoplay: false,
      observedAtMonotonicMs: Date.now(),
    });
    await renderOnce();

    const box = findNode(renderer.root as TreeNode, 'playback-cover-box');
    const image = findNode(renderer.root as TreeNode, 'playback-cover-image');
    let ready = Boolean(image?.image) && !image?.loading;
    for (let i = 0; i < 50 && !ready; i++) {
      // oxlint-disable-next-line no-await-in-loop -- test waits for the render loop
      await new Promise((resolve) => setTimeout(resolve, 20));
      // oxlint-disable-next-line no-await-in-loop -- test waits for the render loop
      await renderOnce();
      const current = findNode(renderer.root as TreeNode, 'playback-cover-image');
      ready = Boolean(current?.image) && !current?.loading;
    }

    expect(box?.visible).toBe(true);
    expect(image?.image).toBeTruthy();
    expect(image?.loadError).toBeFalsy();
    // The bar's inner height is 3 rows; the art must use all of them so the
    // center-cropped `cover` fit still shows the whole composition.
    expect(image?.height).toBe(3);
    expect(image?.width).toBe(8);
    await ui.shutdown();
  });
});
