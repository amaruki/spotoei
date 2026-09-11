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

interface FbProbe {
  width: number;
  height: number;
  frameBuffer: { width: number; height: number };
}

interface TreeNode {
  id?: string;
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

function getFb(renderer: { root: unknown }): FbProbe {
  const node = findNode(renderer.root as TreeNode, 'visualizer-full-fb');
  if (!node) throw new Error('visualizer-full-fb renderable not found');
  const probe = node as unknown as FbProbe;
  return {
    width: probe.width,
    height: probe.height,
    frameBuffer: { width: probe.frameBuffer.width, height: probe.frameBuffer.height },
  };
}

function makeUi(renderer: Parameters<typeof createUiCore>[0]) {
  return createUiCore(renderer, baseState, {
    onKey: () => {},
    onSearchSubmit: () => {},
    onSelectLibrary: () => {},
    onSelectQueue: () => {},
  });
}

describe('fullscreen visualizer frame buffer', () => {
  it('fills the panel width and keeps the backing buffer in sync', async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 120, height: 40 });
    const ui = makeUi(renderer);
    ui.setRoute({ kind: 'visualizer' });
    await renderOnce();

    const fb = getFb(renderer);
    expect(fb.width).toBeGreaterThan(104);
    expect(fb.height).toBeGreaterThan(20);
    expect(fb.frameBuffer.width).toBe(fb.width);
    expect(fb.frameBuffer.height).toBe(fb.height);
    await ui.shutdown();
  });

  it('tracks terminal resizes for both the renderable and the backing buffer', async () => {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 120, height: 40 });
    const ui = makeUi(renderer);
    ui.setRoute({ kind: 'visualizer' });
    await renderOnce();

    const initial = getFb(renderer);
    resize(160, 50);
    await renderOnce();
    const wider = getFb(renderer);
    expect(wider.width).toBeGreaterThan(initial.width);
    expect(wider.frameBuffer.width).toBe(wider.width);
    expect(wider.frameBuffer.height).toBe(wider.height);

    resize(70, 24);
    await renderOnce();
    const narrower = getFb(renderer);
    expect(narrower.width).toBeLessThanOrEqual(70);
    expect(narrower.width).toBeGreaterThan(0);
    expect(narrower.frameBuffer.width).toBe(narrower.width);
    await ui.shutdown();
  });

  it('paints visualizer frames without throwing after a resize', async () => {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 100, height: 30 });
    const ui = makeUi(renderer);
    ui.setRoute({ kind: 'visualizer' });
    ui.setVisualizerFrame({
      mode: 'spectrum',
      data: Array.from({ length: 64 }, () => 0.5),
    });
    await renderOnce();
    resize(90, 28);
    ui.setVisualizerFrame({
      mode: 'oscilloscope',
      data: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5],
    });
    await renderOnce();
    expect(() => ui.setVisualizerFrame({ mode: 'spectrum', data: [0.2, 0.8, 0.4] })).not.toThrow();
    await ui.shutdown();
  });

  it('renders the bar group centered in the captured frame', async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 120,
      height: 40,
    });
    const ui = makeUi(renderer);
    ui.setRoute({ kind: 'visualizer' });
    ui.setVisualizerFrame({
      mode: 'spectrum',
      data: Array.from({ length: 64 }, () => 1),
    });
    await renderOnce();

    const lines = captureCharFrame().split('\n');
    let minX = Number.POSITIVE_INFINITY;
    let maxX = -1;
    for (const line of lines) {
      [...line].forEach((ch, x) => {
        if ('█▂▃▄▅▆▇'.includes(ch)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      });
    }

    expect(maxX).toBeGreaterThan(minX);
    const leftMargin = minX;
    const rightMargin = renderer.width - 1 - maxX;
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(1);
    await ui.shutdown();
  });
});
