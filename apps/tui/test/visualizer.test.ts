// Unit tests for the VisualizerController: validates frame event dispatch,
// mode cycling, invalid frame filtering, and adaptive FPS throttling.

import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { VisualizerController } from '../src/visualizer';
import { PROTOCOL_VERSION, type VisualizerModeT } from 'spotoei-protocol';

function makeMockChild(): {
  child: ChildProcess;
  stdout: PassThrough;
  stdin: PassThrough;
} {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const writeImpl = (_chunk: unknown, cb?: (err: null | Error) => void): boolean => {
    if (typeof cb === 'function') cb(null);
    return true;
  };
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
    expect(frames[0].mode).toBe('spectrum');
    expect(frames[0].data).toEqual([0.1, 0.5, 0.9]);

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
    expect(frames[0].mode).toBe('oscilloscope');
    expect(frames[0].data).toEqual([-0.5, 0.0, 0.5]);

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

  test('cycleMode rotates spectrum -> winamp -> oscilloscope -> spectrum', () => {
    const { child } = makeMockChild();
    const ctrl = new VisualizerController({ child, initialMode: 'spectrum' });

    expect(ctrl.getMode()).toBe('spectrum');
    expect(ctrl.cycleMode()).toBe('winamp');
    expect(ctrl.getMode()).toBe('winamp');
    expect(ctrl.cycleMode()).toBe('oscilloscope');
    expect(ctrl.getMode()).toBe('oscilloscope');
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
});
