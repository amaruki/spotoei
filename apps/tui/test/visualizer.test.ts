// Unit tests for the VisualizerController: validates frame event dispatch,
// mode cycling, invalid frame filtering, and adaptive FPS throttling.

import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  VisualizerController,
  formatBlockMeter,
  formatSpectrumBar,
  resampleBands,
} from '../src/visualizer';
import { PROTOCOL_VERSION, type VisualizerModeT } from 'spotoei-protocol';

const writeImpl = (_chunk: unknown, cb?: (err: null | Error) => void): boolean => {
  if (typeof cb === 'function') cb(null);
  return true;
};

function makeMockChild(): {
  child: ChildProcess;
  stdout: PassThrough;
  stdin: PassThrough;
} {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  (stdin as unknown as { write: typeof writeImpl }).write = writeImpl;
  const child = {
    stdout,
    stdin,
    exitCode: null,
    kill: () => true,
    once: () => child,
    on: () => child,
  } as unknown as ChildProcess;
  return { child, stdout, stdin };
}

describe('VisualizerController unit tests', () => {
  test('subscribes and receives valid spectrum frames', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();

    const frames: { mode: VisualizerModeT; data: number[] }[] = [];
    ctrl.subscribe((mode, data) => {
      frames.push({ mode, data });
    });

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 1,
        data: { bands: [0.1, 0.5, 0.9] },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(frames.length).toBe(1);
    expect(frames[0]!.mode).toBe('spectrum');
    expect(frames[0]!.data).toEqual([0.1, 0.5, 0.9]);

    ctrl.stop();
  });

  test('subscribes and receives valid waveform frames', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'oscilloscope' });
    ctrl.start();

    const frames: { mode: VisualizerModeT; data: number[] }[] = [];
    ctrl.subscribe((mode, data) => {
      frames.push({ mode, data });
    });

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.waveform',
        seq: 2,
        data: { samples: [-0.5, 0.0, 0.5] },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(frames.length).toBe(1);
    expect(frames[0]!.mode).toBe('oscilloscope');
    expect(frames[0]!.data).toEqual([-0.5, 0.0, 0.5]);

    ctrl.stop();
  });

  test('drops malformed frames exceeding boundary clamps', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();

    const frames: number[][] = [];
    ctrl.subscribe((_mode, data) => {
      frames.push(data);
    });

    // Invalid: band value > 1.0 violates zod boundary clamp
    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 1,
        data: { bands: [1.5, 0.2] },
      }) + '\n',
    );

    // Invalid: missing bands field
    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 2,
        data: {},
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(frames.length).toBe(0);
    ctrl.stop();
  });

  test('cycleMode rotates spectrum -> winamp -> oscilloscope -> off -> spectrum', () => {
    const { child } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });

    expect(ctrl.getMode()).toBe('spectrum');
    expect(ctrl.cycleMode()).toBe('winamp');
    expect(ctrl.getMode()).toBe('winamp');
    expect(ctrl.cycleMode()).toBe('oscilloscope');
    expect(ctrl.getMode()).toBe('oscilloscope');
    expect(ctrl.cycleMode()).toBe('off');
    expect(ctrl.getMode()).toBe('off');
    expect(ctrl.cycleMode()).toBe('spectrum');
    expect(ctrl.getMode()).toBe('spectrum');
  });

  test('setEnabled(false) silences frame delivery to subscribers', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();

    const frames: number[][] = [];
    ctrl.subscribe((_mode, data) => {
      frames.push(data);
    });

    ctrl.setEnabled(false);

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 1,
        data: { bands: [0.1, 0.2] },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(frames.length).toBe(0);

    ctrl.setEnabled(true);

    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 2,
        data: { bands: [0.3, 0.4] },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual([0.3, 0.4]);

    ctrl.stop();
  });

  test('downgrades from 60 to 30 FPS after 10 slow frames and upgrades back after 60 fast frames at 30', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();
    // Trigger 15 slow frames (>22ms) at 60 FPS to drop to 30.
    for (let i = 0; i < 15; i++) {
      stdout.write(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'event',
          event: 'visualizer.spectrum',
          seq: i + 1,
          data: { bands: [0.1, 0.2] },
        }) + '\n',
      );
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(ctrl.getCurrentFps()).toBe(30);

    // With windowed hysteresis (15s cooldown, 10s stable), fast frames
    // within cooldown without reaching 60 stable frames remain at 30 FPS.
    for (let i = 0; i < 30; i++) {
      stdout.write(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'event',
          event: 'visualizer.spectrum',
          seq: i + 100,
          data: { bands: [0.5, 0.5] },
        }) + '\n',
      );
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(ctrl.getCurrentFps()).toBe(30);

    ctrl.stop();
  });

  test('stop() rejects pending visualizer.configure responses', async () => {
    const { child } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();

    // start() already calls syncConfig(); now force a fresh one and stop before response.
    const sendPromise = (ctrl as unknown as { syncConfig: () => Promise<void> }).syncConfig();
    ctrl.stop();
    // The pending promise must reject instead of dangling.
    await expect(sendPromise).rejects.toThrow('visualizer controller stopped');
  });

  test('formatBlockMeter maps levels to 8 unicode block characters and space for 0', () => {
    expect(formatBlockMeter(0)).toBe(' ');
    expect(formatBlockMeter(-0.5)).toBe(' ');
    expect(formatBlockMeter(NaN)).toBe(' ');
    expect(formatBlockMeter(0.05)).toBe(' ');
    expect(formatBlockMeter(0.15)).toBe('▂');
    expect(formatBlockMeter(0.30)).toBe('▃');
    expect(formatBlockMeter(0.45)).toBe('▄');
    expect(formatBlockMeter(0.60)).toBe('▅');
    expect(formatBlockMeter(0.72)).toBe('▆');
    expect(formatBlockMeter(0.85)).toBe('▇');
    expect(formatBlockMeter(1.0)).toBe('█');
    expect(formatBlockMeter(1.5)).toBe('█');
  });

  test('resampleBands scales band arrays to target widths cleanly', () => {
    const bands = [0.0, 0.5, 1.0];
    expect(resampleBands(bands, 3)).toEqual([0.0, 0.5, 1.0]);
    const downsampled = resampleBands(bands, 2);
    expect(downsampled.length).toBe(2);
    const upsampled = resampleBands(bands, 6);
    expect(upsampled.length).toBe(6);
  });

  test('formatSpectrumBar converts 64 bands to unicode block meter string', () => {
    const bands64 = Array.from({ length: 64 }, (_, i) => i / 63);
    const bar = formatSpectrumBar(bands64);
    expect(bar.length).toBe(64);
    expect(bar.startsWith(' ')).toBe(true);
    expect(bar.endsWith('█')).toBe(true);

    // Resampled to 16 characters
    const bar16 = formatSpectrumBar(bands64, 16);
    expect(bar16.length).toBe(16);
  });
  test('VisualizerController tracks 64-band frames and renders bar meter', async () => {
    const { child, stdout } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });
    ctrl.start();

    const { promise, resolve } = Promise.withResolvers<void>();
    ctrl.subscribe(() => {
      resolve();
    });

    const bands64 = Array.from({ length: 64 }, (_, i) => Math.sin((i / 64) * Math.PI));
    stdout.write(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'event',
        event: 'visualizer.spectrum',
        seq: 1,
        data: { bands: bands64 },
      }) + '\n',
    );

    await promise;

    expect(ctrl.getLatestBands().length).toBe(64);
    const rendered = ctrl.renderBar();
    expect(rendered.length).toBe(64);
    expect(rendered).toContain('█');

    ctrl.stop();
  });
});
